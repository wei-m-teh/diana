# Diana mobile (Flutter)

The Android and iOS clients sign in through Amazon Cognito using authorization
code + PKCE. An authenticated request to API Gateway returns a room-scoped
LiveKit token; voice and text then travel through LiveKit Cloud to the Diana
agent on ECS Fargate. No laptop token server is needed.

## Configuration

The bundled .env contains only these public values, taken from CDK outputs:

```dotenv
LIVEKIT_TOKEN_ENDPOINT=https://your-api.execute-api.us-east-1.amazonaws.com/sessions
COGNITO_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/your-pool
COGNITO_DOMAIN=https://your-domain.auth.us-east-1.amazoncognito.com
COGNITO_CLIENT_ID=your-mobile-client-id
```

Never bundle LiveKit API secrets, AWS credentials, passwords or user tokens.
Self-registration is disabled; an administrator creates the Cognito account.
The Android and iOS callback scheme is com.diana.app. Registered redirects are
com.diana.app:/oauth2redirect and com.diana.app:/signout.

Access tokens stay in memory. Refresh tokens use platform secure storage.
The app refreshes before starting a new conversation if necessary. Signing out
clears local tokens, attempts refresh-token revocation and opens Cognito logout.
API Gateway requires an access token with diana/sessions.create; there is no
anonymous endpoint fallback.

## Build and validate

```bash
flutter pub get
flutter analyze
flutter test
flutter build apk --release --target-platform android-arm64
```

On this EC2 host, source ../.build-tools/env.sh first to use the installed Flutter,
Android SDK and Java toolchains. The APK is build/app/outputs/flutter-apk/app-release.apk.
It uses the repository's development signing configuration and is a test build,
not a store release. Rebuild after changing .env.

iOS builds require macOS and Apple signing. The callback URL scheme and Keychain
entitlements are configured, but an iOS binary has not been built or tested on EC2. Android can be built on EC2 and
installed on a phone or AWS Device Farm device. See
[Device Farm testing](devicefarm/README.md) for the test runner.

See [AWS infrastructure](../infra/README.md) for deployment and account setup.

## Installing the Android test build on a phone

Open the temporary APK download link in Chrome on the phone. Open the downloaded
Diana.apk, allow Chrome to install apps from this source if Android prompts, and
tap Install. Launch Diana, choose Sign in, then Google, and grant microphone
access when starting a conversation. Internet access is required; the phone
does not need to share a network with the EC2 instance.

The current APK is ARM64 and uses the project's development signing key.
Download links last at most one hour and can be regenerated. CDK manages a
separate private MobileDownloads bucket with public access blocked and a
one-day object expiration rule. No public bucket or Lambda policy is used.
