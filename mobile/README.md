# Diana — mobile (Flutter)

A cross-platform [Flutter](https://flutter.dev/) frontend for Diana that runs on
**Android, iOS**, web, and desktop from one codebase. Built on the
[LiveKit Flutter SDK](https://github.com/livekit/client-sdk-flutter) and the
[agent-starter-flutter](https://github.com/livekit-examples/agent-starter-flutter)
template, customized for Diana.

It supports voice and text, transcriptions, and (optionally) camera/screen video
input. It explicitly dispatches the **`diana`** named agent, matching the
backend in [`../agent`](../agent).

## How it connects (important)

A mobile app must **not** embed your `LIVEKIT_API_SECRET`. Instead it fetches a
short-lived token from LiveKit Cloud's **token server** (a dev-only feature),
using a *sandbox ID*. Everything still flows through your LiveKit Cloud project,
so the phone never needs to reach your laptop directly — only the agent and the
phone both need to point at the same Cloud project.

```
phone (Flutter app) ──token server──▶ LiveKit Cloud ◀──registers── agent (your laptop)
                         (sandbox)        (room)         "diana"
```

## Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) (run `flutter doctor`)
- For Android: Android Studio + an Android device or emulator
- For iOS (later): Xcode on a Mac
- The **agent** running and registered as `diana` (see [`../agent`](../agent))
- LiveKit Cloud **token server** enabled (Settings → Token server), and its
  sandbox ID

## Setup

```bash
cd mobile
cp .env.example .env        # paste your LIVEKIT_SANDBOX_ID
flutter pub get
```

## Run on a device

1. Make sure the agent is running (in `../agent`: `uv run python src/agent.py dev`).
2. Connect your phone (USB debugging on) or start an emulator.
3. Check it's detected: `flutter devices`
4. Run: `flutter run` (pick your phone if prompted)

Then tap **Talk to Diana**, grant microphone permission, and talk or type.

### Build an installable APK (Android)

```bash
flutter build apk --release
# output: build/app/outputs/flutter-apk/app-release.apk
```
Transfer that APK to your phone and install it (allow "install from unknown
sources"), or install directly over USB:
```bash
flutter install
```

## Configuration notes

- The agent name (`diana`) is set in `lib/controllers/app_ctrl.dart`. It must
  match the agent's `AGENT_NAME`.
- For a hardcoded token instead of the sandbox (quick one-off testing), see the
  `hardcodedServerUrl` / `hardcodedToken` constants in the same file.
- For production, replace the sandbox token source with your own token endpoint
  (`EndpointTokenSource`). See
  [token generation](https://docs.livekit.io/home/server/generating-tokens/).
- App display name is set via `android:label` in
  `android/app/src/main/AndroidManifest.xml`. The Android `applicationId` is
  still the template default (`com.livekit.example.VoiceAssistantFlutter`);
  rename it before any real release.
