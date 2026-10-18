# OpenRouter configuration

Diana can call OpenRouter directly for conversation and camera analysis while
keeping LiveKit Cloud for realtime media. Integration follows the
[LiveKit OpenRouter plugin guide](https://docs.livekit.io/agents/models/llm/openrouter/).
The existing SDK stays pinned at 1.5.17; its matching OpenAI plugin supplies
`LLM.with_openrouter` (this does not require an OpenAI API key).

## Local configuration

Put these settings in the ignored `agent/.env.local`:

```dotenv
DIANA_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=provider/model-id
OPENROUTER_VISION_MODEL=provider/image-capable-model-id
```

Choose exact model IDs from OpenRouter. The conversational model needs streaming
and tool calling for the camera tool. The vision model needs image input; it
can differ from the conversational model. If omitted, the vision model defaults
to the conversational model, so that model must support images to retain vision.
No model is chosen or purchased automatically. Configuration errors fail clearly;
there is no silent fallback to LiveKit Inference or another model.

The code default remains `DIANA_LLM_PROVIDER=livekit`. The selected deployment
configuration uses `deepseek/deepseek-v4.1-flash` via OpenRouter for both
conversation and vision. The key is stored in the tagged `diana/openrouter` secret.

## AWS deployment

1. Once the key is supplied, store it in a dedicated JSON Secrets Manager secret
   named `diana/openrouter`: `{"OPENROUTER_API_KEY":"..."}`. Use the EC2 instance
   role and tag it `application=conversation-agent` at creation. Never commit the
   key or put it in frontend/mobile environment files.
2. Set `OPENROUTER_SECRET_ARN` and `OPENROUTER_MODEL` in ignored `infra/.env`.
   Optionally set `OPENROUTER_VISION_MODEL` as above. CDK requires the secret ARN
   and model together; the ARN is a reference, not the key value.
3. Review CDK diff and deploy. ECS receives the key through its Secrets field;
   the execution role can read the referenced secret. Neither token/profile
   Lambda nor the web/mobile app receives the OpenRouter key. Existing auth,
   stack-wide cost tags and ECS tag propagation remain intact.
4. Verify streaming replies, tool calls, image interpretation and personality
   behavior with the chosen models after credentials are available.

Speech routing is independently controlled by `DIANA_SPEECH_PROVIDER` (default
`livekit`). Set it to `openrouter` in `infra/.env` to route Deepgram Nova-3 STT
and the five Aura-2 voices through the same OpenRouter secret. The speech model
IDs remain `deepgram/nova-3` and `deepgram/aura-2`; voice keys map to canonical
IDs such as `aura-2-delia-en`. Premium ElevenLabs/Cartesia voices retain their
existing LiveKit route and are not covered by this migration.

OpenRouter STT transcribes completed audio segments, using the session's Silero
VAD. It does not provide interim transcripts through this integration. This can
change turn latency and interruption behavior compared with streaming STT.
The pinned OpenAI plugin assumes SSE for unknown TTS models; `OpenRouterTTS`
selects its raw audio stream implementation instead. MP3 is decoded to LiveKit
audio frames as it arrives. Recheck this adapter on SDK upgrades.

OpenRouter usage is billed by OpenRouter and is not covered by AWS resource tags.
LiveKit still carries realtime media and provides the configured noise enhancement.

## Checks

Run `uv sync --locked` and `uv run pytest tests/test_model_provider.py
 tests/test_personality.py` in `agent`, and `npm run build` / `npm test` in `infra`.
Provider unit tests do not send network requests. Agent behavior tests and real
camera inference tests require valid provider credentials and incur model usage.
The behavior judge also uses OpenRouter when it is selected, avoiding a hidden
LiveKit LLM dependency in those tests. Live selected-model results are recorded below; configuration tests alone do not
establish model response quality.

## Selected-model verification (2026-09-27)

`deepseek/deepseek-v4.1-flash` is configured for conversation and vision. Its
OpenRouter catalog entry lists image inputs and tool support. Fourteen live
functional tests passed, including camera tool calls, image interpretation,
conversation grounding and voice acknowledgments. Provider/configuration tests
and lint passed. A separate style run passed 8 of 12 checks: two judgments were
ambiguous (a contextual "How was it?" and a greeting), while two flagged a reserved closing at minimum trait settings and a 22-word
response against a 20-word ordinary-turn target. The user clarified that the
reserved response can be appropriate at those settings; neither example alone
establishes a personality defect. Speech remains on LiveKit Inference and its quota errors
remain a separate blocker to a working voice conversation.

After explicit user approval, deployed on 2026-09-27 as ECS task definition
`DianaAgentTask7A48C0A2:9`. ECS reports rollout completed with one running task;
the new worker registered with LiveKit. Task configuration confirms OpenRouter
and the selected model for both conversation and vision. Startup verification
does not establish that the separate LiveKit speech quota issue has cleared.

## Speech deployment verification (2026-09-27)

Deployed `DIANA_SPEECH_PROVIDER=openrouter` in task revision
`DianaAgentTask7A48C0A2:10`, using the existing tagged OpenRouter secret. Thirty
agent routing/personality tests, nineteen infrastructure tests, TypeScript
compilation and targeted Python lint passed. The real application factories
successfully synthesized Delia audio and transcribed it with Nova-3.

A temporary LiveKit room tested the deployed agent (and was deleted afterward):
- Typed "Please say hello briefly." produced a transcript and audible reply.
- Synthetic microphone audio "What is two plus two?" was transcribed correctly
  and produced the audible reply "Four."
- Production logs confirmed `session speech provider: openrouter`; no speech
  gateway 429s occurred during this test. The plugin logs a harmless missing
  request-ID warning because OpenRouter uses a different response header.

This verifies the server media path, not phone-specific playback, network
conditions or interruption latency. Test with Delia or another Deepgram voice;
the premium voice routes remain on LiveKit Inference.

## Select voice output independently (ElevenLabs v4 or OpenRouter)

`DIANA_SPEECH_PROVIDER` still controls speech recognition. The optional
`DIANA_TTS_PROVIDER` overrides **output only**, with `livekit`, `openrouter`, or
`elevenlabs`. Leave it blank to preserve existing routing, including legacy
premium-voice routing through LiveKit. Changing TTS does not change the LLM,
transcription, authentication, or media transport.

For direct ElevenLabs v4, add to ignored `agent/.env.local` for local use:

```dotenv
DIANA_SPEECH_PROVIDER=openrouter
DIANA_TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=your-elevenlabs-voice-id
ELEVENLABS_TTS_MODEL=eleven_v4
```

Choose a voice ID available to your ElevenLabs account, not a Deepgram name such
as `delia`. This configuration uses **one deployment-wide voice**: the saved
web/Android voice choice remains saved but is overridden while direct ElevenLabs
is selected. It does not add an ElevenLabs voice browser to the UI.

For AWS, store `{"ELEVENLABS_API_KEY":"..."}` in a dedicated secret named
`diana/elevenlabs`, tagged `application=conversation-agent`. Use the EC2 instance
profile when creating it. Set `ELEVENLABS_SECRET_ARN`, `ELEVENLABS_VOICE_ID`,
`ELEVENLABS_TTS_MODEL=eleven_v4`, and `DIANA_TTS_PROVIDER=elevenlabs` in ignored
`infra/.env`. Do not put the raw key there or in frontend/mobile files. CDK injects
only the secret reference into ECS and grants secret access to its execution
role. The key is not sent to OpenRouter or either Lambda. Existing stack-wide
cost tags and ECS service tag propagation remain intact. Missing credentials or
voice IDs fail configuration; there is no silent change to another provider.

The direct adapter uses ElevenLabs' documented
[HTTP stream endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)
with model `eleven_v4` and mono `pcm_24000`. Audio frames are emitted as bytes
arrive. LiveKit segments LLM text before synthesis because this is HTTP audio
streaming, not a persistent text-input WebSocket. It avoids the older TTS
WebSocket path, which does not serve v4 dialogue; see
[ElevenLabs streaming choices](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/tts-vs-ttd-websockets).
Sentence segmentation can affect latency and prosody: real voice quality and
latency must be measured after an ElevenLabs key and voice are supplied. The
adapter passes text through unchanged, but this change does not make Diana
insert emotional tags automatically; her existing spoken-output rules remain.
ElevenLabs calls are billed directly by ElevenLabs, separately from OpenRouter.

To switch back to OpenRouter and the existing Deepgram choices:

```dotenv
DIANA_SPEECH_PROVIDER=openrouter
DIANA_TTS_PROVIDER=openrouter
OPENROUTER_TTS_MODEL=
OPENROUTER_TTS_VOICE=
```

With explicit `openrouter`, an incompatible premium catalog voice is rejected
rather than silently using LiveKit. Leaving `DIANA_TTS_PROVIDER` blank restores
legacy behavior. To try a different OpenRouter voice model, set both
`OPENROUTER_TTS_MODEL` and `OPENROUTER_TTS_VOICE` to the exact provider IDs in
`agent/.env.local` (local) or `infra/.env` (AWS). The existing OpenRouter key is
used. This is also a deployment-wide override of the saved voice selection.
The selected model must support OpenRouter's `/audio/speech` API and MP3 output;
provider-specific options, custom voice cloning and model availability are not
validated by the configuration tests. Consult the
[OpenRouter TTS catalog](https://openrouter.ai/api/v1/models?output_modalities=speech).

Provider changes in AWS require CDK deployment and a new conversation. The code
addition alone does not change the live provider, create a secret, or deploy.
