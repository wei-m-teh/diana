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
short-lived token from a **token endpoint**, then connects to LiveKit Cloud
using that token. The token request carries the `diana` agent name, so LiveKit
dispatches the agent into the room.

**Recommended for local dev: reuse the web app's token endpoint.** The web app
(`../web`) already serves `POST /api/token` and dispatches `diana`. Point the
mobile app at it with `LIVEKIT_TOKEN_ENDPOINT`. Only the *token fetch* goes to
your laptop; the actual audio/video flows through LiveKit Cloud.

```
phone (Flutter app)
   │  1. POST /api/token  (over your LAN, to the web app on your laptop)
   ▼
laptop web app (../web)  ──mints token w/ "diana" dispatch──▶ returns token
   │
   │  2. connect with token
   ▼
LiveKit Cloud (room)  ◀──registers "diana"── agent (../agent, on your laptop)
```

So three things run during testing: the **agent**, the **web app** (used here
only as the token endpoint), and the **mobile app** — all pointed at the same
LiveKit Cloud project, with the phone and laptop on the same Wi-Fi.

> Alternative: LiveKit Cloud's **token server** (a *sandbox ID*) avoids needing
> the web app, but the sandbox feature is deprecated and unavailable on newer
> projects. If yours has it, set `LIVEKIT_SANDBOX_ID` instead. See `.env.example`.

## Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) (run `flutter doctor`)
- For Android: Android Studio + an Android device or emulator
- For iOS (later): Xcode on a Mac
- The **agent** running and registered as `diana` (see [`../agent`](../agent))
- The **web app** running (see [`../web`](../web)) — used as the token endpoint
- Your phone and laptop on the **same Wi-Fi**, and your laptop's **LAN IP**

## Setup

```bash
cd mobile
cp .env.example .env
# Edit .env → set LIVEKIT_TOKEN_ENDPOINT to http://<your-laptop-LAN-ip>:3000/api/token
# Find your IP: macOS `ipconfig getifaddr en0`, Linux `hostname -I`
flutter pub get
```

## Run on a device

You need **three** things running, all on the same LiveKit Cloud project:

1. **Agent** — in `../agent`: `uv run python src/agent.py dev`
2. **Web app** (token endpoint) — in `../web`: `pnpm dev --hostname 0.0.0.0`
   (the `--hostname 0.0.0.0` makes it reachable from your phone over the LAN)
3. **Mobile app**:
   - Connect your phone (USB debugging on) or start an emulator.
   - Confirm it's detected: `flutter devices`
   - Run: `flutter run` (pick your phone if prompted)

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
