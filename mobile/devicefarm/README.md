# Android tests in AWS Device Farm

Build the APK using mobile/README.md. The test signs into Cognito through the
system browser, starts a call, mutes the microphone, exchanges two text turns
with Diana, and disconnects. No physical phone or laptop is required.

Run from mobile with an EC2 instance role that can manage Device Farm:

```bash
python devicefarm/run.py build/app/outputs/flutter-apk/app-release.apk \
  --credentials-file /private/path/temporary-cognito-user.json
```

The private JSON needs username and password for a dedicated, temporary Cognito
test user with a permanent password and no pending challenges. Never use a
personal account. Credentials are included only in the private Device Farm test
package, not the APK. Appium logs run at warning level to avoid logging typed
credentials. Delete the test account and Device Farm test-package upload when
the run ends, and delete local credential files and the generated test ZIP.

The runner uses us-west-2, reuses/creates the Diana mobile project, selects one
Android phone, and limits the test to ten minutes. Device Farm may incur charges.
It checks that the endpoint rejects anonymous requests before scheduling a run.
Run identifiers are written to build/devicefarm/run.json, including the
testUploadArn needed for cleanup.

The APK contains only public Cognito/API settings. Existing historical reports
in RESULTS.md describe earlier anonymous builds and do not validate this release.
