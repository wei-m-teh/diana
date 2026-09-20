# Deployment verification — 2026-09-19

Stack Diana completed its Cognito migration in us-east-1 using the EC2 instance
profile (account 602900100639). No static AWS credentials were configured.

- Website: https://d3beq72xn0nkjq.cloudfront.net
- Session endpoint: https://dmfqtunyok.execute-api.us-east-1.amazonaws.com/sessions
- Cognito pool: us-east-1_Va2cf55It
- CloudFormation: UPDATE_COMPLETE.
- Lambda Function URL configurations: empty.
- Lambda resource policy: one apigateway.amazonaws.com statement, constrained to
  account 602900100639 and API dmfqtunyok / $default / POST / sessions.
- Anonymous and malformed access tokens: HTTP 401.
- Cognito ID token: rejected.
- Real browser authorization code + PKCE login: passed.
- Valid access token: session creation passed; subsequent requests generated
  distinct room names.
- Browser conversation: two questions answered correctly; received audio had
  nonzero energy. Call disconnect and Cognito logout passed.
- Temporary validation account: deleted; no email was sent.
- ECS: one desired task, one running, zero pending.
- Infrastructure typecheck and all five tests passed.
- Static web production build passed (existing unrelated lint warnings remain).
- Flutter analysis and all three widget tests passed.
- Android ARM64 release APK built successfully (55.5 MB); uses development signing.
- iOS callback plist validated; iOS binary build requires macOS and Apple signing.

Self-registration is disabled. An administrator must provision the user's own
Cognito account before personal use. Android Device Farm validation passed on a Pixel 8, including native Cognito
sign-in and a two-turn conversation. All temporary validation users were removed
(confirmed zero users remain). Details are in mobile/devicefarm/RESULTS.md.

## Google federation deployment

- Google provider deployed to the existing Cognito pool; enabled alongside
  COGNITO for both web and mobile clients.
- Google client secret stored in Secrets Manager as diana/google-oauth. CDK
  contains only a dynamic reference, not the secret value.
- Provider credentials matched the supplied JSON; requested Google scopes are
  openid, email and profile. No domain or email allowlist is configured.
- Browser checks of both Cognito client authorization flows showed the Google
  choice and reached Google's Email or phone screen.
- No real Google account was used by automation. First Google authentication,
  user provisioning and a subsequent conversation await the user's sign-in.
- Anonymous and invalid-token API requests still returned HTTP 401.
- Lambda still has only the exact API Gateway service-principal invocation
  permission and no Function URL.
- No web/mobile rebuild or Fargate service update was needed.

## Profiles deployment — 2026-09-19

- Stack Diana reached UPDATE_COMPLETE using the EC2 instance role.
- Deployed the retained DynamoDB profile table, profile Lambda, and JWT-protected
  GET /me and PATCH /me routes. Existing Cognito clients and login are unchanged.
- Both profile methods reject anonymous and malformed tokens; ID tokens are rejected.
- A temporary user completed browser Cognito PKCE login. Starting a session
  created their profile with trusted email, default voice, and free subscription.
- Updating display name and voice preference persisted across subsequent session
  creation and profile reads. Attempts to change user ID, email, or subscription,
  and invalid voice keys, were rejected.
- Deployed profile and session Lambda policies were checked: exact API Gateway
  stage/method/path and source account; no public invocation or Function URLs.
- Two conversation turns, received audio, call disconnect, and logout passed.
- The temporary profile and Cognito account were deleted. No invitation was sent.
- Implementation validation: TypeScript build and all 14 tests passed.
- No web/mobile rebuild is required. Saved voice preferences do not affect audio
  until voice dispatch is implemented in a later step.

## Profile settings UI — 2026-09-19

- Added web and mobile Profile / Settings screens for display name and saved
  voice preference, with read-only email and plan details.
- Real browser checks passed: Cognito login, save both fields, reopen persisted
  values, cancel/confirm discarding unsaved edits, and subsequent conversation
  with received audio. Temporary Cognito account and profile were removed.
- Flutter analysis passed; all seven tests passed, including profile request
  authorization, field-specific updates, failed-save retry, voice selection,
  persisted values, load retry, and unsaved-change navigation.
- The static web production build passed with existing unrelated lint warnings.
- The screen explicitly explains that saving a voice does not yet change speech.

### Completed builds — 2026-09-20

- Recovered build tooling after the EC2 restart; Node now resides in the ignored
  .build-tools directory rather than temporary storage.
- Final web production build passed, including the explicit voice-selector label.
- Android ARM64 release build 1.0.0 (15) succeeded. APK signature verification
  passed and its certificate matches the previously distributed build 14.
- APK environment contains only the four approved public deployment settings.
- Build 15 was packaged as Diana-Android-v15.zip in the private downloads bucket.
  A complete presigned download matched its SHA-256; unsigned access returned 403.
- This build was validated with Flutter tests, not a new Device Farm run.

## Cost allocation tagging — 2026-09-20

- Activated the existing user-defined `application` cost allocation tag (it had
  been inactive). Cost Explorer API confirmed Active with no activation errors.
- Deployed `application=conversation-agent` on the Diana stack and independently
  verified it on all 29 taggable CloudFormation resources through service APIs.
- Enabled ECS-managed tags and SERVICE propagation. Tagged and verified the
  existing running task without forcing a replacement; desired/running counts match.
- Tagged and verified both imported Diana secrets, the generated deployment Lambda
  log group, Diana mobile Device Farm project, default VPC networking resources,
  and the current task network interface. Existing unrelated tags were preserved.
- Added the postdeploy reconciliation script and tagging to future Device Farm
  project use. Recorded the tagging requirement in root AGENTS.md.
- Shared development EC2 host and shared CDK bootstrap resources were not assigned
  exclusively to this application. Historical billing was not backfilled.
- TypeScript build, all 14 existing tests, and deployment passed. Stack status is
  UPDATE_COMPLETE; application resources and authentication were not replaced.
