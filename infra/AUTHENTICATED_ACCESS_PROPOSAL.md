> Implementation is now in the CDK stack and clients. See [deployment documentation](README.md) for the current setup.

# Proposed authenticated access for Diana

Status: implemented and deployed on 2026-09-19. The previous public Lambda URL
and wildcard invocation permissions have been removed. The following records
the selected design. See README.md for current operational instructions.

## Recommended architecture

```text
Web UI assets: browser -> CloudFront -> private S3

Web / mobile -> Cognito User Pool (sign in)
Web / mobile -> API Gateway (validate Cognito access token + required scope)
             -> token Lambda (authorize user and issue LiveKit room token)

Web / mobile <-> LiveKit Cloud <-> existing Fargate agent
```

Replace the Lambda Function URL with an API Gateway HTTP API. Require an
Cognito access token on `POST /sessions`, using the HTTP API JWT authorizer.
Cognito is the selected identity provider; organizational SSO is not part of
this design. Both the web UI and Flutter app use the same user pool, with
separate public app clients and their own allowed callback/logout URLs.

Configure the authorizer with the Cognito user-pool issuer, both approved app
client IDs as audiences, and the required resource-server scope
`diana/sessions.create`. Cognito access tokens normally identify the client
through `client_id`; API Gateway checks this when `aud` is absent. Requiring
the scope prevents accepting a normal ID token as API authorization.

Remove the Function URL and both wildcard-principal invocation permissions
from CDK. The replacement Lambda resource policy grants `lambda:InvokeFunction`
to the service principal `apigateway.amazonaws.com`, constrained to the
specific API, deployed stage and `POST /sessions` route by source ARN, with a
source-account condition. There is no anonymous Lambda invocation permission
and no Function URL that bypasses API Gateway.

API Gateway remains internet-reachable so ordinary mobile devices can use it,
but session creation requires authorization. This is distinct from a private
network API. If AppSec also prohibits internet-reachable authenticated APIs,
an internal access design with private API connectivity and VPN access must be
selected instead; that would also change the mobile/device-testing setup.

## User and session authorization

The UI's Sign in button opens Cognito managed login for the user's Cognito
account and returns to the app after successful authentication. Use the OAuth
authorization-code flow with PKCE for both clients; mobile opens the system
browser and returns through a registered app callback. Request the
`diana/sessions.create` scope during authorization. This flow supports the
custom API scope; do not substitute a direct password API sign-in flow and
assume it will automatically issue that scope.

Use one Cognito User Pool with separate web and mobile public app clients,
without client secrets. An identity pool is not required: the clients call
API Gateway with bearer tokens and do not need AWS credentials.
Client applications must not
contain an OAuth client secret, AWS access key, shared API password or LiveKit
API secret. Store mobile refresh credentials in platform-protected storage.
Public configuration such as endpoint, issuer and client ID can remain in
`.env` or the generated web configuration.

The client sends its access token in the Authorization header. API Gateway
rejects missing, invalid, expired, wrong-issuer, wrong-audience or insufficient-
scope tokens. Lambda uses the validated Cognito subject and any configured
group/entitlement claims to authorize Diana access. It must fail closed if trusted claims are
missing. Caller-supplied user IDs, room IDs and agent names remain untrusted.

Lambda creates a new room for an authorized conversation and issues the
existing short-lived LiveKit token. Derive participant identity from the
validated subject plus a conversation identifier, so one person can have
multiple sessions without sharing another person's room. Retain narrowly
scoped room permissions and server-selected Diana dispatch.

These are two different tokens: the login access token authorizes the request
to start a conversation; the LiveKit room token authorizes joining that room.
Neither API Gateway nor Lambda carries the continuous audio stream. Room-token
expiry controls admission, not a hard conversation-duration limit. Immediate
revocation of an active conversation would require explicitly disconnecting
the participant through the LiveKit server API.

## Changes to implement after design agreement

- `infra/lib/diana-stack.ts`: remove public Function URL resources; add the
  Cognito User Pool, managed-login domain, separate public web/mobile app
  clients, resource-server scope, HTTP API, scoped JWT authorizer,
  route-specific Lambda permission, throttling,
  access logs that exclude credentials, and updated public client configuration.
  Deployment continues to use the EC2 instance profile.
- `infra/lambda/token.ts`: require validated caller claims and authorized
  entitlement, use user-bound participant identities, and serve `/sessions`.
  Keep LiveKit credentials in Secrets Manager and redact tokens from logs.
- Web and Flutter clients: add Cognito sign-in, callback handling, sign-out and
  token refresh; attach a
  current access token whenever fetching a LiveKit room token. Remove anonymous
  production fallback paths. No Supabase login is proposed.
- Tests: assert that no Function URL or wildcard-principal Lambda invocation
  grant exists; verify that unauthorized requests cannot obtain room tokens;
  verify authorized users get separate rooms. Device Farm must use an approved
  test identity through the same authentication path, without an anonymous
  test bypass or credentials baked into the APK.
- Document operational limits: API throttling is not a hard per-user usage or
  spending cap. Add application quotas/session-duration enforcement if required
  by the intended access policy.

CloudFront OAC is an alternative for restricting a Lambda URL to one
distribution. By itself it does not authenticate the caller at a public
CloudFront endpoint. The recommended API Gateway design makes user
authorization explicit and removes the Function URL entirely.

## Decisions needed

Identity provider selected: Cognito User Pools for both clients and API
Gateway authorization.

For initial testing, the proposed account policy is administrator-created
Cognito users with self-registration disabled. Account enrollment and MFA
settings can be adjusted to the intended user population before implementation.
The remaining network-policy question is whether AppSec allows an
internet-reachable authenticated API or also requires private network access.

The prior proposal to restore public guest token access is withdrawn. No new
deployment or paid Device Farm run should occur under that design.

## AWS references

- [HTTP API JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [API Gateway invocation of Lambda and scoped permissions](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html)
- [PKCE for Cognito authorization-code flows](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html)
- [Cognito access tokens and custom API scopes](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [CloudFront origin access control for Lambda URLs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
