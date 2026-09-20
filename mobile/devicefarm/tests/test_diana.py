"""Exercise the deployed Diana backend through a real Android app, via Appium."""
import base64
import json
import os
from pathlib import Path
import time
import unittest
from urllib.request import Request, urlopen


class DianaConversation(unittest.TestCase):
    session = None

    def command(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = Request('http://127.0.0.1:4723' + path, data=data, method=method,
                          headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=180) as response:
            result = json.load(response)
        value = result.get('value')
        if isinstance(value, dict) and 'error' in value:
            raise RuntimeError(value)
        return value

    def api(self, method, path, body=None):
        return self.command(method, '/session/' + self.session + path, body)

    def setUp(self):
        result = self.command('POST', '/session', {'capabilities': {'alwaysMatch': {
            'platformName': 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:deviceName': os.environ['DEVICEFARM_DEVICE_NAME'],
            'appium:udid': os.environ['DEVICEFARM_DEVICE_UDID'],
            'appium:app': os.environ['DEVICEFARM_APP_PATH'],
            'appium:autoGrantPermissions': True,
            'appium:newCommandTimeout': 180,
        }}})
        self.session = result['sessionId']
        self.artifacts = Path(os.environ.get('DEVICEFARM_LOG_DIR', '.'))

    def capture(self, name):
        self.artifacts.joinpath(name + '.xml').write_text(self.api('GET', '/source'))
        self.artifacts.joinpath(name + '.png').write_bytes(
            base64.b64decode(self.api('GET', '/screenshot')))

    def find(self, strategy, value, timeout=90):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            elements = self.api('POST', '/elements', {'using': strategy, 'value': value})
            if elements:
                return elements[0]['element-6066-11e4-a52e-4f735466cecf']
            time.sleep(1)
        self.fail('Element not found: ' + value)

    def tap(self, label):
        element = self.find('accessibility id', label)
        self.api('POST', '/element/' + element + '/click', {})

    def test_two_turn_conversation(self):
        credentials = json.loads(Path('credentials.json').read_text())
        self.tap('Sign in')
        email = self.find('xpath', '//android.widget.EditText[@password="false"]')
        self.api('POST', '/element/' + email + '/click', {})
        self.api('POST', '/element/' + email + '/value', {'text': credentials['username']})
        password = self.find('xpath', '//android.widget.EditText[@password="true"]')
        self.api('POST', '/element/' + password + '/click', {})
        self.api('POST', '/element/' + password + '/value', {'text': credentials['password']})
        # Do not send Android Back to a Custom Tab: that can cancel OAuth.
        submit = self.find('xpath', '//android.widget.Button[@text="Sign in"]')
        self.api('POST', '/element/' + submit + '/click', {})
        del credentials
        self.find('xpath', '//*[contains(@text,"TALK TO DIANA") or contains(@content-desc,"TALK TO DIANA")]')
        self.capture('01-welcome')
        self.tap('TALK TO DIANA')
        self.find('accessibility id', 'End call')
        self.tap('Mute microphone')
        self.find('accessibility id', 'Unmute microphone')
        self.tap('Show transcript')
        for index, (question, answer) in enumerate([
            ('What is nineteen plus twenty eight? Reply with only the digits.', '47'),
            ('What is twenty one plus thirty eight? Reply with only the digits.', '59'),
        ], 1):
            field = self.find('class name', 'android.widget.EditText')
            # Focus Flutter's real text input before asking Android to type.
            # Setting accessibility text on an unfocused node can change the
            # Android UI tree without updating Flutter's text controller.
            self.api('POST', '/element/' + field + '/click', {})
            field = self.find('xpath', '//android.widget.EditText[@focused="true"]')
            self.api('POST', '/element/' + field + '/value', {'text': question})
            self.find('xpath', '//*[@content-desc="Send message" and @enabled="true"]', timeout=20)
            if self.api('GET', '/appium/device/is_keyboard_shown'):
                self.api('POST', '/appium/device/hide_keyboard', {})
            self.capture(f'input-{index}')
            self.tap('Send message')
            # Answers are deliberately absent from the user prompt, so an echo
            # of our outgoing message cannot satisfy this assertion.
            self.find('xpath', f'//*[contains(@text,"{answer}") or contains(@content-desc,"{answer}")]')
            self.capture(f'0{index + 1}-reply')
        self.tap('End call')
        self.find('accessibility id', 'TALK TO DIANA')
        self.capture('04-disconnected')

    def tearDown(self):
        if self.session:
            try:
                self.capture('final')
            finally:
                # Explicitly end a call even when an assertion fails, so the
                # test cannot leave the agent conversation running.
                try:
                    elements = self.api('POST', '/elements', {'using': 'accessibility id', 'value': 'End call'})
                    if elements:
                        element = elements[0]['element-6066-11e4-a52e-4f735466cecf']
                        self.api('POST', '/element/' + element + '/click', {})
                finally:
                    self.api('DELETE', '')


if __name__ == '__main__':
    unittest.main(verbosity=2)
