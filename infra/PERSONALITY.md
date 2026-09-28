# Web personality settings

In the web app, open **Profile / Settings → Diana’s personality**. Adjust the five
sliders (0–100), then choose **Save changes**. The saved style applies when starting
a new web conversation; an active conversation keeps its original style. Resetting
to balanced sets every slider to 50 and requires Save changes to persist.

The traits are openness, conscientiousness, extraversion, agreeableness, and
neuroticism. Low and high labels describe their direction. Values 0–33, 34–66, and
67–100 select low, balanced, and high behavioral guidance. The exact numeric value
also goes into the instructions as intensity, but individual slider increments are
not guaranteed to produce measurable differences. This is a conversational style
control, not a validated personality assessment. Neuroticism controls expressive
sensitivity without encouraging distress. Accuracy, honesty, privacy, and safety
remain fixed. These settings do not change the audio voice or add long-term memory.

## Data and dispatch

- Existing Cognito authentication and API Gateway JWT authorization are unchanged.
- `PATCH /me` accepts `personality` containing all five traits as integer values
  from 0 through 100. Unknown keys and invalid values are rejected before storage.
- DynamoDB stores the object in `preferences.personality`, keyed by Cognito subject.
  Google sign-in uses that same Cognito identity. Nested updates preserve other
  preferences. Legacy profiles return balanced defaults without a migration write.
- Only sessions authenticated with `COGNITO_WEB_CLIENT_ID` include the saved
  personality in signed LiveKit agent dispatch metadata. Request bodies cannot
  override it. Mobile sessions retain the existing default behavior.
- Metadata format: `{"personality":{"version":1,"traits":{"openness":50,
  "conscientiousness":50,"extraversion":50,"agreeableness":50,"neuroticism":50}}}`.
- The agent validates the metadata and generates instructions from fixed text.
  Missing, malformed, or unsupported personality metadata retains the original
  agent instructions. No user-supplied instruction text is interpolated.

Dispatch uses the documented [agent dispatch metadata](https://docs.livekit.io/agents/server/agent-dispatch/)
mechanism. Behavior tests use LiveKit's [agent unit testing](https://docs.livekit.io/testing/unit-tests/).

## Validation and deployment

Run `npm run build && npm test` in `infra`, `npm run build:static` in `web`, and
`uv run pytest -q` in `agent` (model behavior tests require LiveKit credentials).
The test suite covers defaults, input validation, profile isolation, preservation
of preferences, web/mobile dispatch separation, malformed metadata, contrasting
styles, and factual honesty. Model-based checks sample behavior; they do not
prove consistency in every conversation.

Deploy the CDK stack after building the static web export. This updates the web
assets, profile/session Lambdas, and agent image together. Keep the existing
Google/Cognito deployment configuration. The stack supplies `COGNITO_WEB_CLIENT_ID`;
no new secrets or AWS resources are needed. Existing `application=conversation-agent`
tags and ECS propagation remain in place. As with other agent deployments, active
calls may end after the agent's shutdown grace period.

## Brief companion conversation

The shared agent defaults to one short thought (usually 3–15 words, under 20
for ordinary chat), with space for the user to take the next turn. It reacts to everyday
stories without unsolicited coaching, avoids habitual follow-up questions and
service-desk closings, and uses a few example exchanges to establish brevity.
Explicit requests for detail and essential safety context can receive longer
answers; responses are not mechanically truncated. High extraversion changes
energy, not the default turn length. These base instructions also apply to mobile
sessions, which still do not receive the web-only personality settings.

Behavior regression tests in `agent/tests/test_agent.py` exercise several turns
at default, low, and high trait settings, plus a request for a detailed explanation.
An additional eight-turn everyday dialogue checks exact word counts and relevance
at default, balanced, and high trait settings. Length is measured in code rather
than by a model judge. These are sampled behavior checks, not a runtime word cap.
They use model judgments following the
[LiveKit unit-testing pattern](https://docs.livekit.io/testing/unit-tests/).

## Occasional spoken hesitation

Diana may use a short "Hmm...", "Um...", "Well," or an internal ellipsis when
weighing a choice. Most turns stay filler-free, and recent hesitation cues should
not be repeated in the next two turns. Simple facts, audio checks, goodbyes and
urgent advice stay direct. These cues count within the existing short-turn style;
there is no random filler insertion, artificial timer delay, SSML or audio cutoff.
A user asking to skip fillers should be respected.

The existing Delia / Deepgram Aura-2 voice renders these cues. Commas and periods
suggest short pauses; an ASCII ellipsis suggests a thinking pause, with duration
chosen by the provider rather than guaranteed by Diana. See
[Deepgram's text-to-speech prompting guide](https://developers.deepgram.com/docs/text-to-speech-prompting).

Validation on 2026-09-27: the previous prompt failed the new contextual-rhythm
checks. Live verification of the revised prompt was blocked by LiveKit inference
quota exhaustion (HTTP 429, `inference_quota_exceeded`, zero remaining credits).
The synthetic streaming TTS check also failed to connect, so spoken pause quality
has not been verified. Rerun `test_speech_rhythm_is_contextual`,
`test_does_not_repeat_recent_hesitation`, and the agent behavior suite after quota
is restored. The change does not provision more credits or change providers.
