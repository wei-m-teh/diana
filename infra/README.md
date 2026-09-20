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
