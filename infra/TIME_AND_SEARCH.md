# Time awareness and web search

Time and search extend Diana's existing LiveKit tools. Cognito authentication,
API Gateway authorization, profile ownership and AWS cost tags are unchanged.
There are no new AWS resources or external credentials.

## Timezone preferences

`preferences.timezone` in the existing DynamoDB profile is an IANA timezone name
for a manual override, or `null` for **Use device timezone**. Missing legacy
values normalize to device mode. Both web and Android settings can change it.
Manual preference changes apply to the next conversation on either platform.

Web obtains the timezone through `Intl.DateTimeFormat`; Android obtains the IANA
ID from `java.util.TimeZone` through a native method channel. Neither sends its
clock as the source of current time. The authenticated `/sessions` request may
include `deviceTimezone`; the server validates it and resolves it against the
saved override. The signed agent dispatch contains the resolved timezone, mode,
and the server-generated participant identity. Clients cannot select another
room, participant identity, agent or arbitrary instructions.

During a call clients recheck device timezone every 30 seconds and on foreground
resume. Web republishes after reconnection; Android clears its last-sent value
on reconnect. The agent accepts `diana.timezone` updates only from the identity
in the signed dispatch, validates IANA names, and ignores device updates in
manual mode. Daylight-saving changes need no client update: `zoneinfo` converts
the current UTC server instant using the zone's rules. If no timezone is known,
the model gets UTC explicitly and must not present it as the user's local time.

The `llm_node` adds a fresh, ephemeral time context for each generation, including
recent in-session turn timestamps. It does not accumulate stale clock messages
in conversation history. `get_current_time` can also check another IANA zone.
This is not persistent memory, scheduling, reminders, or location tracking.

## Web lookup

When `OPENROUTER_API_KEY` is configured, the agent exposes `search_web`, using
`OPENROUTER_MODEL` and the existing backend-only key. It makes an independent
OpenRouter Chat Completions request with `openrouter:web_search` (Exa engine).
The conversational LiveKit adapter never has to parse OpenRouter server-tool
events. The API was verified with the configured DeepSeek model.

Each invocation allows one provider search, at most three results, 2,000 excerpt
characters per result, 700 generated tokens and a 25-second total network
budget. Calls are serialized within the session. Identical queries are cached
for 60 seconds; the cache holds at most ten entries. Search and model usage are
billed by OpenRouter, outside AWS cost allocation tags.

Results must contain provider citation annotations with HTTP(S) URLs. An answer
without citations, a timeout, or provider failure returns an explicit unavailable
result; it is not treated as verified knowledge. Retrieved summaries and excerpts
are untrusted data. Instructions tell Diana to search for current facts, explicit
lookups, and uncertain knowledge, but not ordinary personal conversation. Only
the search query is sent, not the full conversation. Prefer minimal queries
without unnecessary private details.

The agent publishes a bounded `diana.sources` packet to the requesting
participant, containing the query, retrieval timestamp and source titles/URLs.
Both clients accept these packets only from agent participants and validate URL
schemes. Sources appear in expandable cards in the transcript. Up to ten recent
search cards are kept in the current client session; they are not persisted.
URLs are not read aloud. Retrieval time is not claimed to be publication time.

The LLM supplies a short contextual `acknowledgment` with its search query.
The search tool queues that interruptible speech before starting its network
request, once per reply even if multiple searches are needed. Empty or overly
long acknowledgments fall back to "Let me check that." If the model has already
emitted a spoken preamble before the search call, the tool skips its own
acknowledgment to prevent a duplicate announcement. Playback and search run concurrently. This avoids
silence during the lookup without requiring a separate LLM generation; the
ordinary response follows once results arrive. The acknowledgment change was deployed with location sharing in agent revision
13 on September 28, 2026; see [Location sharing](LOCATION.md).

## Validation and release

- Agent: deterministic DST, timezone ownership/override, fresh-context isolation,
  URL filtering, citation requirement and provider failure tests; live model
  checks for local date/time and selective tool use.
- API: both client IDs, signed dispatch ownership, profile override/reset,
  validation and prior auth/profile regression tests.
- Android: method-channel mocks, authorized session payload, profile compatibility,
  source URL validation, widget tests, analyzer and ARM64 release build.
- Web: TypeScript, lint and static export build.

Build web with `npm run build:static`, deploy CDK, and install the new Android
APK (build 17) to enable automatic timezone reporting on Android. Existing
Android installs can still connect; a manual timezone saved through web settings
works for them, but they do not send device timezone or display source cards.

### Deployed September 27, 2026

CDK deployed the profile/session APIs, static web bundle, and agent task revision
12 (image `8204f376cd814ba27a255d85060ac7592ee1e3e948e46b373f50a909273d73c3`).
Android build 17 was uploaded to the existing private MobileDownloads bucket.
The live checks verified the exact CloudFront bundle, rejection of anonymous
API requests, Tokyo local date/time, audible replies to typed and spoken input,
and delivery of three search citation links. Physical-phone installation remains
to be verified by the user.
