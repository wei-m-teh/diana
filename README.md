# Diana

Diana is a personal companion AI you can **talk to or type with** — a fluid,
continuous conversation partner that listens, learns from the conversation, and
offers advice on the things you care about.

This repository is a monorepo with two parts:

| Directory | What it is | Stack |
|-----------|------------|-------|
| [`agent/`](./agent) | Diana's "brain" — the realtime voice/text agent | Python · [LiveKit Agents](https://docs.livekit.io/agents/) · LiveKit Inference |
| [`web/`](./web) | The web app you use to talk to Diana | TypeScript · Next.js · [LiveKit React components](https://docs.livekit.io/frontends/) |
| [`mobile/`](./mobile) | Cross-platform mobile app (Android now, iOS later) | Dart · [Flutter](https://flutter.dev/) · [LiveKit Flutter SDK](https://github.com/livekit/client-sdk-flutter) |

The split is intentional: the **agent is the product** and stays the same across
every surface. Today there's a web frontend; Android and iOS are just additional
frontends that connect to the same agent later. New capabilities ("give Diana
access to X") attach to the agent as **tools**, not as forked logic.

## Architecture

```
┌────────────┐   audio + text over WebRTC   ┌──────────────────────────┐
│  web/      │ ───────────────────────────▶ │  LiveKit Cloud (room)    │
│  Next.js   │ ◀─────────────────────────── │  + LiveKit Inference      │
│  (browser) │   agent speech + transcripts │                          │
└────────────┘                              └────────────┬─────────────┘
                                                          │ joins room
                                                          ▼
                                            ┌──────────────────────────┐
                                            │  agent/ (Diana)          │
                                            │  STT → LLM → TTS pipeline │
                                            └──────────────────────────┘
```

- **Speech and text both work.** The agent runs a Speech-to-Text → LLM →
  Text-to-Speech pipeline; text input/output is enabled on the same session, so
  you can speak or type interchangeably.
- **Fluid conversation** comes from LiveKit's turn detection, voice activity
  detection, interruption handling, and preemptive generation.
- **No per-provider API keys.** Models are served through
  [LiveKit Inference](https://docs.livekit.io/agents/models/inference) using your
  LiveKit Cloud credentials.

## Prerequisites

- A free [LiveKit Cloud](https://cloud.livekit.io/) project (provides
  `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`)
- [uv](https://docs.astral.sh/uv/) (Python) and Node.js 20+ with
  [pnpm](https://pnpm.io/) (web)
- Optional but recommended: the [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/) (`lk`)

## Quick start

You need **two processes running**: the agent and the web app. Both read the
same LiveKit credentials.

### 1. Run the agent

```bash
cd agent
uv sync
cp .env.example .env.local        # then fill in LIVEKIT_URL / API_KEY / API_SECRET
uv run python src/agent.py download-files   # one-time: VAD + turn-detector models
uv run python src/agent.py dev
```

Tip: `uv run python src/agent.py console` lets you talk to Diana directly in
your terminal without the web app.

### 2. Run the web app

```bash
cd web
pnpm install
cp .env.example .env.local        # same LIVEKIT_* values; AGENT_NAME=diana
pnpm dev
```

Open http://localhost:3000 and click **Talk to Diana**. The frontend dispatches
to the agent by name (`diana`), so the agent process must be running.

### 3. (Optional) Run on your phone

The [`mobile/`](./mobile) Flutter app runs Diana on Android and iOS. Because a
mobile app can't safely embed your API secret, it gets tokens from LiveKit
Cloud's **token server** instead of the credentials directly:

1. In LiveKit Cloud → **Settings → Token server**, toggle it on and copy the
   **sandbox ID**.
2. `cd mobile && cp .env.example .env` and paste the sandbox ID into
   `LIVEKIT_SANDBOX_ID`.
3. `flutter pub get`, connect your phone (USB debugging on), then `flutter run`.

The agent must be running (step 1) and pointed at the **same** LiveKit Cloud
project. The phone connects through Cloud, so it doesn't need to reach your
laptop directly. Full details in [`mobile/README.md`](./mobile/README.md).

## Tests

Diana's behavior is covered by the LiveKit Agents
[testing framework](https://docs.livekit.io/agents/start/testing/) (LLM-judged
behavioral tests). They require LiveKit credentials, since the judge runs via
LiveKit Inference.

```bash
cd agent
uv run pytest
```

## Project status

✅ **Web interface works** — voice + text conversation with Diana through the
web app.
✅ **Mobile app scaffolded** — Flutter app (`mobile/`) for Android + iOS,
dispatching to the same `diana` agent.

Planned next:

- **Long-term memory** so Diana remembers across sessions, not just within one
- **Research / tools** (web access and other resources) exposed as agent tools
- Polish the mobile UX and ship a real iOS build

## Credits

Bootstrapped from LiveKit's official
[`agent-starter-python`](https://github.com/livekit-examples/agent-starter-python),
[`agent-starter-react`](https://github.com/livekit-examples/agent-starter-react),
and [`agent-starter-flutter`](https://github.com/livekit-examples/agent-starter-flutter)
starters, then customized for Diana.
