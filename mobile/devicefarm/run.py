"""Upload an APK and run the Diana conversation test on one AWS-hosted phone.

Uses the AWS CLI credential chain (the EC2 instance profile on this host).
Creates/reuses a Diana Device Farm project in us-west-2. Writes run details
under mobile/build/devicefarm; never reads backend credentials.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
REGION = 'us-west-2'


def aws(operation, **kwargs):
    command = ['aws', 'devicefarm', operation, '--region', REGION, '--output', 'json']
    for key, value in kwargs.items():
        command.extend(['--' + key.replace('_', '-'), json.dumps(value) if isinstance(value, (dict, list)) else str(value)])
    output = subprocess.check_output(command)
    return json.loads(output) if output.strip() else {}


def upload(project, path, kind):
    item = aws('create-upload', project_arn=project, name=path.name, type=kind)['upload']
    request = Request(item['url'], data=path.read_bytes(), method='PUT',
                      headers={'Content-Type': 'application/octet-stream'})
    with urlopen(request, timeout=300):
        pass
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        current = aws('get-upload', arn=item['arn'])['upload']
        if current['status'] == 'SUCCEEDED':
            return item['arn']
        if current['status'] == 'FAILED':
            raise RuntimeError(current.get('message') or current.get('metadata') or 'Device Farm upload processing failed')
        time.sleep(3)
    raise TimeoutError('Upload processing timed out')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--device-arn', help='Optional specific Android device; otherwise select an available phone')
    parser.add_argument('--credentials-file', type=Path, required=True, help='Private JSON with a temporary Cognito username and password; never bundled in APK')
    args = parser.parse_args()
    if not args.apk.is_file():
        parser.error('APK does not exist')
    # The app bundles .env. Only public client configuration belongs in the APK.
    with ZipFile(args.apk) as apk:
        env = apk.read('assets/flutter_assets/.env').decode()
        keys = [line.split('=', 1)[0].strip() for line in env.splitlines()
                if '=' in line and not line.lstrip().startswith('#')]
        if set(keys) - {'LIVEKIT_TOKEN_ENDPOINT', 'COGNITO_ISSUER', 'COGNITO_DOMAIN', 'COGNITO_CLIENT_ID'}:
            raise ValueError('APK contains unexpected environment keys; review before upload')
        settings = dict(line.split('=', 1) for line in env.splitlines()
                        if '=' in line and not line.lstrip().startswith('#'))
        endpoint = settings.get('LIVEKIT_TOKEN_ENDPOINT', '').strip().strip('\"\'')
        if not endpoint.startswith('https://'):
            raise ValueError('Device Farm requires a reachable HTTPS token endpoint in the APK')
        request = Request(endpoint, data=b'{}', headers={'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=30):
                raise ValueError('Endpoint unexpectedly allowed anonymous access')
        except HTTPError as error:
            if error.code != 401:
                raise ValueError('Expected HTTP 401 for anonymous access') from error
        print('Authenticated endpoint preflight passed (anonymous access rejected).', flush=True)
    credentials = json.loads(args.credentials_file.read_text())
    if not credentials.get('username') or not credentials.get('password'):
        raise ValueError('Temporary Cognito credentials are required')
    output = ROOT.parent / 'build' / 'devicefarm'
    output.mkdir(parents=True, exist_ok=True)
    package = output / 'diana-tests.zip'
    wheels = output / 'wheelhouse'
    subprocess.run([sys.executable, '-m', 'pip', 'download', '--only-binary=:all:',
                    '--dest', str(wheels), '-r', str(ROOT / 'requirements.txt')], check=True)
    with ZipFile(package, 'w') as archive:
        archive.write(ROOT / 'tests/test_diana.py', 'tests/test_diana.py')
        archive.writestr('credentials.json', json.dumps(credentials))
        archive.write(ROOT / 'requirements.txt', 'requirements.txt')
        for wheel in wheels.glob('*.whl'):
            archive.write(wheel, 'wheelhouse/' + wheel.name)
    package.chmod(0o600)
    projects = aws('list-projects')['projects']
    project = next((p for p in projects if p['name'] == 'Diana mobile'), None)
    if project is None:
        project = aws('create-project', name='Diana mobile', default_job_timeout_minutes=10)['project']
    aws('tag-resource', resource_arn=project['arn'],
        tags=[{'Key': 'application', 'Value': 'conversation-agent'}])
    device_arn = args.device_arn
    if not device_arn:
        devices = aws('list-devices')['devices']
        eligible = [d for d in devices if d['platform'] == 'ANDROID' and d.get('availability') in {'AVAILABLE', 'HIGHLY_AVAILABLE'}
                    and d.get('formFactor') == 'PHONE' and int(d['os'].split('.')[0]) >= 10]
        if not eligible:
            raise RuntimeError('No available Android phone; retry later or specify --device-arn')
        device = sorted(eligible, key=lambda d: int(d['os'].split('.')[0]), reverse=True)[0]
        device_arn = device['arn']
        print('Selected:', device['name'], 'Android', device['os'], flush=True)
    app = upload(project['arn'], args.apk, 'ANDROID_APP')
    tests = upload(project['arn'], package, 'APPIUM_PYTHON_TEST_PACKAGE')
    (output / 'auth-test-upload.json').write_text(json.dumps({'arn': tests}))
    spec = upload(project['arn'], ROOT / 'testspec.yml', 'APPIUM_PYTHON_TEST_SPEC')
    run = aws('schedule-run', project_arn=project['arn'], app_arn=app,
              name='Diana two-turn conversation ' + time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()),
              device_selection_configuration={'filters': [{'attribute': 'ARN', 'operator': 'IN', 'values': [device_arn]}], 'maxDevices': 1},
              test={'type': 'APPIUM_PYTHON', 'testPackageArn': tests, 'testSpecArn': spec},
              execution_configuration={'jobTimeoutMinutes': 10, 'videoCapture': True, 'skipAppResign': False})['run']
    project_id = project['arn'].split(':project:')[1]
    run_id = run['arn'].split('/')[-1]
    result = {'projectArn': project['arn'], 'runArn': run['arn'], 'deviceArn': device_arn,
              'testUploadArn': tests,
              'consoleUrl': f'https://us-west-2.console.aws.amazon.com/devicefarm/home?region=us-west-2#/mobile/projects/{project_id}/runs/{run_id}'}
    (output / 'run.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
