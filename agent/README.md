# Diana — agent

Diana's realtime brain: a [LiveKit Agents](https://docs.livekit.io/agents/)
worker that holds a fluid voice/text conversation as a personal companion.

It uses a Speech-to-Text → LLM → Text-to-Speech pipeline powered by
[LiveKit Inference](https://docs.livekit.io/agents/models/inference) (no separate
model-provider API keys), with turn detection, voice activity detection, and
background noise cancellation for natural, continuous conversation. Text input
and output are enabled on the same session, so users can speak or type.

The persona, models, and (future) tools live in [`src/agent.py`](./src/agent.py).
Diana registers as a **named** agent, `diana`, so frontends must explicitly
dispatch to that name (see `AGENT_NAME` here and in `../web`).

## Setup

```bash
uv sync
cp .env.example .env.local   # fill in LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
```

Credentials come from a [LiveKit Cloud](https://cloud.livekit.io/) project. With
the [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/) you can populate the
env file automatically:

```bash
lk cloud auth
lk app env -w -d .env.local
```

## Run

```bash
# one-time: download Silero VAD + turn-detector model files
uv run python src/agent.py download-files

# talk to Diana directly in the terminal
uv run python src/agent.py console

# run for use with the web frontend / telephony
uv run python src/agent.py dev

# production
uv run python src/agent.py start
```

## Tests

Behavioral evals built on the LiveKit Agents
[testing framework](https://docs.livekit.io/agents/start/testing/). The LLM judge
runs via LiveKit Inference, so credentials must be set.

```bash
uv run pytest
```

Current coverage (`tests/test_agent.py`): warm companion greeting, remembering
what the user shared earlier in the conversation, not fabricating private facts,
and refusing harmful requests.

When changing Diana's instructions or adding tools, follow the test-driven
approach described in [AGENTS.md](./AGENTS.md): write or update a test first.

## Deploying

A production-ready `Dockerfile` is included. See
[deploying to production](https://docs.livekit.io/deploy/agents/).
