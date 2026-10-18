# Diana on AWS

CDK deploys a private S3 website behind CloudFront, Cognito sign-in, an API
Gateway HTTP API with JWT authorization, session-token and profile Lambdas,
a DynamoDB profile table, and an ECS Fargate agent. LiveKit Cloud carries
voice/text and provides inference.

The web and mobile apps use separate public Cognito clients with authorization
code + PKCE. Both request `diana/sessions.create`. API Gateway validates the
access token before invoking Lambda. The Lambda resource policy permits only
`apigateway.amazonaws.com`, restricted to this account and the exact API,
stage, method and path (`POST /sessions`, `GET /me`, or `PATCH /me`). There is no Lambda Function URL and
no public Lambda principal. CORS is not used as authentication.

[User profiles and preferences](PROFILES.md) documents the profile API, defaults,
storage protections, and current limitations. Existing clients create their
profile automatically when starting a conversation; no APK update is needed.

## Build and deploy

Use Node.js 22+, Docker and the EC2 instance profile. Do not configure static
AWS access keys. The existing secret in Secrets Manager contains LIVEKIT_URL,
LIVEKIT_API_KEY and LIVEKIT_API_SECRET; it is never included in client assets.

```bash
cd web
npm ci
npm run build:static
cd ../infra
npm ci
# Configure AWS_REGION and LIVEKIT_SECRET_ARN in infra/.env.
npm run build
npm test
npm run diff
npm run deploy
```

CDK supplies public config.json at deployment. The static build excludes local
.env files and Next.js API handlers. The dev server's /api/token is for local
development and is not deployed. Deployment outputs are in outputs.json.

## Google sign-in

[Google sign-in setup](GOOGLE_SIGN_IN.md) enables any Google account through
Cognito for both web and mobile. Supply GOOGLE_CLIENT_ID and GOOGLE_SECRET_ARN
together; the secret JSON must contain client_secret. Google sign-in is now
enabled in the deployed web and mobile Cognito clients.

## Accounts and clients

Google users can join on first sign-in without an email or organization allowlist.
Local email/password self-registration is disabled. Create local users in the
Cognito User Pool from the
stack output; choose whether to send an invitation. Users sign in from the
website or mobile app and complete the initial password change. Email is the
login alias; optional authenticator-app MFA is enabled. No Supabase or SSO is
used.

Mobile .env contains only public settings: LIVEKIT_TOKEN_ENDPOINT,
COGNITO_ISSUER, COGNITO_DOMAIN and COGNITO_CLIENT_ID (the mobile client ID).
Rebuild the app after changing them. Redirects use com.diana.app:/oauth2redirect
and com.diana.app:/signout. The web stores tokens in memory and OAuth transaction
state in sessionStorage; mobile stores refresh tokens in secure storage.
Sign-out clears local tokens and attempts refresh-token revocation and browser
logout. Existing access tokens can remain valid until their 15-minute expiry.

## Verification and operations

- Anonymous and malformed-token POST /sessions requests must return 401/403.
- Signed-in access tokens with the correct scope can create isolated rooms.
  ID tokens and tokens from other clients cannot create sessions.
- Lambda validates the authorizer claims before reading the LiveKit secret.
  Each issued LiveKit token admits only its generated room, lasts five minutes
  for admission, and dispatches Diana. It does not limit call duration.
- The API is throttled to 5 requests/second with a burst of 10. This is a shared
  throttle, not a per-user usage quota.
- Fargate has no inbound security-group rules. Its public IP provides outbound
  access to LiveKit; no NAT gateway or load balancer is needed.
- Agent capacity is fixed at one task (2 vCPU / 4 GiB by default). Load test before
  increasing concurrency. A new agent revision can interrupt an active call after
  its 120-second shutdown window. Conversation state is not persisted.
- LiveKit secrets are injected into ECS at startup. Force a new ECS deployment
  after rotating them. Lambda caches secret reads for one minute.
- Cognito, website storage and log groups are retained on stack deletion.
  Secrets and LiveKit resources are external to the stack. AWS and LiveKit
  usage incur charges.

The infrastructure tests reject public Lambda permissions and assert JWT scope
enforcement. Lambda tests cover invalid claims, isolated room grants and error
redaction. Live deployment checks are still required after each release.

## Cost allocation

All dedicated Diana resources use `application=conversation-agent`. CDK applies
this tag to the stack and taggable resources. ECS propagates service tags to new
tasks and enables ECS-managed tags. The account's existing `application` cost
allocation tag must be active in Billing.

`npm run deploy` runs `python3 scripts/tag-existing.py` as a post-deploy hook
using the EC2 instance role (Python 3 and the AWS CLI are required). The script
can also be run separately. This preserves other tags while tagging imported `diana/` secrets, existing
ECS service tasks, automatically created Diana Lambda log groups, and the Diana
mobile Device Farm project in us-west-2. It also covers default networking
resources and current task network interfaces in the dedicated Diana VPC. It
verifies every resource it updates.

In Cost Explorer, filter **Tag → application → conversation-agent**, group by
**Service**, and select daily or monthly granularity. Tag activation and billing
refresh are not immediate. This change does not automatically relabel past bills.

Shared CDK bootstrap resources and the shared EC2 development host are not
exclusively allocated to Diana. Some service charges do not support resource-tag
allocation; shared costs need separate attribution. LiveKit/inference charges
billed outside AWS will not appear in this AWS tag filter.

## Personality settings

The web profile settings include five saved personality sliders. See
[Web personality settings](PERSONALITY.md) for behavior, storage, testing, and deployment.

## Camera vision

[Web camera vision](VISION.md) documents the on-demand camera tool, data flow,
controls, and verification steps.

For optional direct language-model access, see [OpenRouter configuration](OPENROUTER.md).

[Time awareness and web search](TIME_AND_SEARCH.md) covers device timezone detection,
shared timezone preferences, search citations, and validation for web and Android.

[Location sharing](LOCATION.md) covers permission controls, per-conversation
location refresh, saved-location fallback and the AWS city lookup.

## Web conversation attachments

The web call controls include **Share a file** with an optional question. Uploads
use a Cognito-authorized `POST /attachments` API, then a five-minute presigned S3
POST restricted to one generated key, MIME type and exact file size. The session
API registers room ownership in DynamoDB; upload callers cannot supply another
user's room. Only web sessions enable the attachment tool. No public bucket,
Lambda URL, or anonymous Lambda invocation is added.

The agent reads the current room's attachment record and private object using its
ECS task role. Parsing happens in a separate process with CPU, memory and time
limits; long processing does not block the audio event loop. Diana acknowledges
the request, emits processing status, and uses the configured vision LLM to answer.
Video audio uses the configured STT provider. Extracted content is treated as
untrusted evidence, not instructions. Results remain in conversation context;
there is no cross-conversation attachment memory or retrieval.

Supported limits:

- JPEG, PNG and WebP images; PDF, DOCX, UTF-8 TXT and Markdown documents: 20 MiB.
- MP4/MOV/WebM video: 60 MiB and two minutes, at most twelve sampled frames plus
  audio transcription. Sampling can miss short events and does not reliably
  establish continuous motion or evaluate vocal delivery beyond transcript text.
- Documents: first twenty PDF pages and at most 30,000 extracted characters.
  Word paragraphs/tables are included; document images, layout and OCR are not.
  Password-protected and image-only PDFs report an error rather than invented text.
- Ten upload reservations per conversation, including failed/cancelled attempts.

Originals are stored in a private encrypted S3 bucket with a one-day expiration
rule. Session and attachment records have a 24-hour TTL; the agent checks expiry
explicitly because DynamoDB deletion is asynchronous. S3 lifecycle deletion is
also asynchronous, so this is scheduled retention, not an exact deletion deadline.
Local working files are deleted after processing. AI providers receive resized
images, sampled frames and extracted text/audio as needed for the requested
analysis; their own data retention policies also apply. The UI discloses this
before upload. Files are never served as public download links.

CDK supplies `ATTACHMENTS_BUCKET` and `ATTACHMENTS_TABLE` to the agent. The upload
Lambda can put objects but cannot read them; the agent reads uploads and writes only generated media.
All new taggable resources inherit `application=conversation-agent`. Deploy the
static web build, infrastructure and agent together; the upload control needs the
new API and a newly started conversation.


## Media alongside voice (web)

Diana can find existing images (Wikimedia Commons), videos and PDF links (web
search), or create images, Word documents and short videos when explicitly asked.
Media cards appear automatically above the voice conversation controls, with
image previews, document excerpts, source links, attribution, generation progress
and clickable previews/downloads. Videos play only when opened. Uploads analyzed during a conversation also appear
here. Finding a link does not mean Diana has read or watched its contents.

Generated DOCX documents are assembled locally from Diana's text. Images and
videos use the existing server-side OpenRouter key. Configure `DIANA_IMAGE_MODEL`
(default `google/gemini-2.5-flash-image`) and `DIANA_VIDEO_MODEL` (default
`x-ai/grok-imagine-video`). Video generation requests four seconds at 720p, 16:9,
without audio; a replacement model must support those settings. Image/video
requests incur provider charges. Generation is limited to one pending job and
five requests per conversation. Images are capped at 20 MiB and videos at 60 MiB.
Documents accept 30,000 characters; their in-app preview is capped at 6,000 UTF-8
bytes. Full text remains in the downloaded DOCX.

Generation runs in the background so conversation can continue. Jobs are tied to
the active agent session, not a durable queue. Ending the session cancels local
processing; an already submitted provider job may continue and incur charges.
Generated files have the same private storage and scheduled one-day retention as
uploads. Cognito-authorized `POST /media` checks session ownership and expiry
before issuing 15-minute read/download URLs. No generation key is sent to the UI.
Media from previous conversations is not automatically restored.

Images expand in a dialog, documents offer a preview where supported and a
download, and videos use a native player or a YouTube privacy-enhanced embed.
Sites that prohibit embedding require opening the original link. Opening public
media contacts the source site. While a video dialog is open, Diana's playback is
muted and her audio input is disabled to avoid feedback. Closing it resumes the
conversation; an interrupted utterance is not replayed.

Example requests:

- “Show me a photo of a red panda.”
- “Find a video about making sourdough.”
- “Create an image of a cozy cabin in the snow.”
- “Make a Word document with the packing list we discussed.”
- “Create a four-second video of waves reaching a beach.”

Offline coverage includes private asset ownership, URL validation, mocked
provider generation/polling, failure states and document contents. Before
production acceptance, test actual provider generation and playback on the target
phone. Deploy the web build, CDK stack and agent together.

## Content-first conversation UI

The active call opens in voice view. Search results or media switch it into a
conversation view with a compact voice-status strip, a single scrolling timeline,
and call controls outside the scroll area. Speaking/listening state changes do
not switch layouts. **Back to voice** preserves the timeline and **Conversation**
restores it. New result groups reopen content, but updates to an existing media
item do not override an explicit return to voice. Users reading older content
keep their scroll position and can jump to new results/messages.

Search citations appear as whole-card links grouped by query, with destination
domain, a bounded source excerpt, and an optional source-provided image. Images
are not generated or guessed for product cards. Unsupported/missing images use a
neutral icon. Amazon search pages are labeled separately from product links.
Prices, stock and ratings are not inferred. External links open in a new tab;
media previews retain the existing video pause/resume behavior. Search permits up to three searches and six citations per lookup; cards show
three sources initially and can expand to show the rest. This per-lookup budget
is separate from account credit or rate limits. Partial findings identify what
could not be verified rather than implying the user exhausted their allowance.

Missing citation thumbnails are enriched asynchronously from the source page's
Open Graph or Twitter image metadata. Link cards arrive first; preview updates
retain the same group ID and position, without blocking the voice reply. Fetches
use public HTTPS destinations with DNS-pinned connections, validated redirects,
a five-second budget, and a 256 KB HTML prefix; no credentials or cookies are
forwarded. Blocked sites or missing metadata remain usable link cards. Preview
images represent the linked page, not verified product photos. Wikimedia image
search failures fall back to web results and this same preview path. No extra
API key or AWS resource is required. Pending lookups are cancelled on shutdown.

Browser regression (after `npm run build:static` in web):
`node web/tests/conversation-layout.cjs` from the repository root, with Playwright
and Chromium installed. `DIANA_PLAYWRIGHT_MODULE` can point to an existing
Playwright module. The fixture mocks voice/provider services and checks mobile
and desktop layouts, automatic cards, view switching, scroll preservation,
visible call controls, and video pause/resume without paid API requests.

The transcript and shared-content view have independent controls: incoming links
and media open the content area without displaying spoken messages or the text
composer. The bottom transcript button explicitly shows/hides conversation text.
Back to voice also closes the transcript, while keeping shared content available.

Provider connections are warmed asynchronously at session start using bounded,
unauthenticated HEAD requests on the same HTTP pools used for inference. This
warms DNS/TCP/TLS, not model weights or prompt caches, and performs no paid dummy
inference or speech synthesis. ElevenLabs connections stay reusable for up to 120
seconds. Warm-up failure does not block a call. The OpenRouter adapter is pinned
to livekit-plugins-openai 1.5.17's client structure and covered by adapter tests.
Agent `provider_latency` logs contain only stage, sample number and milliseconds
for model first-token, speech first-byte, transcription and end-of-turn timing.
These are stage measurements, not an end-to-end latency guarantee; TTS may emit
multiple samples for one reply.

### Returning from external playback

The web audio renderer resumes LiveKit playback on visibility return, window
focus, page restoration and room reconnection, and after an in-app video closes.
It preserves the current room and conversation and skips recovery while a video
or explicit renderer mute is active. If browser autoplay permission blocks the
attempt, LiveKit exposes the existing Start Audio button for a tap to resume.
Opening a video's external original/source link closes its dialog and releases
Diana's playback/listening pause. Regression coverage lives in
`test/audio-resume.test.ts` and `web/tests/conversation-layout.cjs`.

### Reading source pages

Diana's `read_web_page(url, focus, acknowledgment)` tool opens public HTTPS URLs
provided by the user, search results, or links from a previously read page. It
extracts static text, selects passages matching the requested details, and returns
up to 12 labeled links for further reading. The existing source cards show the
page URL; page text stays in tool context, not the content display. A short spoken
acknowledgment shares the existing once-per-reply behavior with web search.

Reads use DNS-pinned public destinations, verified TLS names, individually checked
redirects, and no cookies, provider credentials, or proxy credentials. Limits are
three reads per reply, two concurrent fetches, four redirect hops, 12 seconds per
read, a 1 MB HTML prefix, 200,000 extracted characters, and 12,000 returned text
characters. Script/style/hidden text is excluded and all extracted text is treated
as untrusted evidence. Truncation and missing focus matches are explicit. This
phase does not run JavaScript, sign in, submit forms, watch videos, or parse remote
PDFs. Blocked pages and unsupported formats produce an unavailable result rather
than a claim that their contents were inspected. No new API key or AWS resource
is required. Tests: `agent/tests/test_web_pages.py`.
