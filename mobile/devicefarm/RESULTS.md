# Cognito Android validation — 2026-09-19

**Result: PASSED** on AWS Device Farm Google Pixel 8, Android 14.

- Cognito browser sign-in and callback to the native app passed.
- Authenticated session creation, LiveKit connection, microphone mute, transcript
  display, two correct conversational replies (47 and 59), and call disconnect passed.
- The endpoint rejected anonymous access before the run was scheduled.
- APK: mobile/build/app/outputs/flutter-apk/app-release.apk (55.5 MB, ARM64).
- SHA-256: `49aa5fce186d1ffc9b74b9b1eb455cd587c3d9168e4d630d3bdac71c29f82067`.
- This APK uses the existing development signing configuration, not store signing.
- [Successful Device Farm run](https://us-west-2.console.aws.amazon.com/devicefarm/home?region=us-west-2#/mobile/projects/55056a85-807c-4902-ba8e-a9cab50e5473/runs/d10c82b6-2b87-417b-8cf4-0b48b12b01b3).
- Test credentials belonged to a temporary account. The account and uploaded
  credential-bearing test package were deleted after the run.
- Two preceding runs corrected test automation: generated Cognito field IDs,
  then a keyboard-dismiss action that cancelled the browser tab. No app or
  infrastructure changes were needed for those test fixes.
- Native logout, refresh across token expiry, and iOS device execution were not
  covered by this run. Browser logout passed separately.

## Historical results for the previous anonymous deployment

# Diana Android build and Device Farm results — 2026-09-19

> Superseded access decision: organizational AppSec prohibits the public
> Lambda policy. The restoration proposal below is withdrawn; do not restore
> it or rerun this anonymous-access deployment. See the
> [authenticated-access proposal](../../infra/AUTHENTICATED_ACCESS_PROPOSAL.md).

## Build

- Built on the EC2 instance using Flutter 3.47.5 / Dart 3.13.4 and Java 17.
- APK: `mobile/build/app/outputs/flutter-apk/app-release.apk` (54.9 MB).
- Version 1.0.0, build 14; current template application ID and debug signing key.
- Bundled `.env` contains only the deployed HTTPS token endpoint; no backend credentials.
- SHA-256: `4c1f44f220cbe10d6e078729d7ea1d53f4d133e77952b1d152950f270948ae94`.
- All three Flutter tests passed, including two accessible-control label checks.
- Flutter analysis: no errors; one existing deprecation in the unused sandbox-token fallback.
- All four CDK/token-service tests passed; assertions cover both URL invocation permissions.

## Physical-device testing

Used the EC2 instance profile to create the `Diana mobile` project in AWS Device
Farm, us-west-2. Tested on Google Pixel 8, Android 14. Each scheduled job was
limited to one phone and ten minutes. All scheduled runs have finished.

1. [Initial run](https://us-west-2.console.aws.amazon.com/devicefarm/home?region=us-west-2#/mobile/projects/55056a85-807c-4902-ba8e-a9cab50e5473/runs/de07956f-219c-4a85-b08c-31377afc90a2): APK installed and launched. Token request returned 403 because the deployed Lambda lacked the resource policy declared by CDK.
2. [After permission restoration](https://us-west-2.console.aws.amazon.com/devicefarm/home?region=us-west-2#/mobile/projects/55056a85-807c-4902-ba8e-a9cab50e5473/runs/7d85660c-1973-446f-8a42-4d006a11dc26): the phone connected and the Diana agent joined. Exact button-name matching failed because decorative icon glyphs were appended to accessible labels. Fixed the labels and added local regression tests.
3. [Corrected APK](https://us-west-2.console.aws.amazon.com/devicefarm/home?region=us-west-2#/mobile/projects/55056a85-807c-4902-ba8e-a9cab50e5473/runs/bb632621-bda6-4b60-a151-13afee485a9d): connected, muted the microphone, and opened the transcript. Automated text entry changed the Android accessibility text without focusing Flutter's input; Send remained disabled and no message was transmitted. The test now focuses the input and waits for Send to become enabled. This corrected test step still needs a device rerun.

Artifacts are under `mobile/build/devicefarm/{first-run,second-run,third-run}`.
A screenshot of the connected app is `mobile/build/devicefarm/diana-connected.png`.

## Remaining deployment blocker

The token Lambda's public resource policy disappeared again after restoration.
The Lambda code and CloudFormation stack had not been redeployed, and CloudTrail
lookups did not provide an explanation. The runner's new endpoint preflight
caught the repeated 403 before scheduling another paid run.

Automatic approval review rejected another restoration, citing the public
access scope. No workaround was attempted after that rejection. Approval is
needed to restore the following existing CDK-declared permissions on
`Diana-TokenFunction0E51A6ED-6LEM6xaL8bYM` in us-east-1:

- Principal `*`, action `lambda:InvokeFunctionUrl`, condition `lambda:FunctionUrlAuthType = NONE`.
- Principal `*`, action `lambda:InvokeFunction`, condition `lambda:InvokedViaFunctionUrl = true`.

This allows anyone who knows the URL to request a five-minute, room-scoped
LiveKit token and connect to Diana, potentially incurring agent/model usage.
It does not grant anonymous direct Lambda SDK invocation or expose backend API
keys. The intended rerun is one Pixel 8 job with a ten-minute timeout.

The APK is ready for testing. A successful two-turn mobile conversation has not
yet been demonstrated. Acoustic microphone/speaker quality, Bluetooth,
background/lock-screen behavior, iOS, and app-store distribution are untested.
