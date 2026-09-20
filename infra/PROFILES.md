# User profiles and preferences

This implements step 1 of the product design using DynamoDB and the existing
Cognito identity. Cognito/Google login, OAuth scopes, app clients, and API Gateway
JWT authorization remain unchanged. Supabase is not used.

## Lifecycle

`GET /me` creates a profile on first access. `POST /sessions` also ensures the
profile exists, so the current web and Android clients need no update. Signing in
alone does not create a record until one of those endpoints is called.

The partition key is the verified Cognito `sub`, never a client-supplied ID or
email. Initial email, verification state, and name come from Cognito AdminGetUser;
the returned subject must match the caller. These identity attributes are an
initial snapshot. Later sign-ins do not overwrite the user's chosen display name.
Separate Cognito identities stay separate even when their emails match.

Each record contains:

```json
{
  "userId": "cognito-sub",
  "schemaVersion": 1,
  "email": "person@example.com",
  "emailVerified": true,
  "displayName": "Person",
  "preferences": { "voiceKey": "delia" },
  "subscription": { "planId": "free", "status": "active" },
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

`subscription` is a server-controlled default record, not a billing integration
or entitlement system. Voice preferences are saved but do not yet affect agent
dispatch. Plan enforcement, usage tracking, and applying the selected voice to conversations are later steps.

## Profile settings UI

After signing in, select **Profile / Settings** on the web app or Android welcome
screen. Opening settings creates your profile if needed. Edit your display name
and preferred voice, then select **Save changes**. Email and plan are read-only.
Both clients reload saved values when you reopen settings, preserve edits on save
failure, and ask before discarding unsaved changes. Voice preference is stored
only; the screen explains that it does not yet change Diana's speaking voice.

Android settings are included in build 15 and later. Install the updated APK over
the existing Diana build. Existing public environment values remain valid.

## API

Use the `ProfileEndpoint` stack output (`https://<api-host>/me`). Both methods
require `Authorization: Bearer <Cognito access token>` with the existing
`diana/sessions.create` scope. ID tokens and anonymous requests are rejected.

- `GET /me`: returns the caller's profile, creating defaults if absent.
- `PATCH /me`: accepts JSON with `displayName`, `voiceKey`, or both; returns the
  updated profile. Display names are trimmed, limited to 100 UTF-16 code units,
  and may be empty; control characters are rejected. Voice keys use the existing
  catalog in `web/lib/voices.ts`. No other fields are accepted.

Example update body:

```json
{ "displayName": "Alex", "voiceKey": "thalia" }
```

Invalid updates return 400, unavailable storage/identity services return a generic
503, and all responses disable caching. The caller cannot select another user's
record. Concurrent initialization uses a conditional write; updates change only
the specified attributes, preserving unrelated preferences and subscription data.
If storage is unavailable, starting a conversation returns 503 and can be retried.

## Infrastructure and operations

CDK creates an encrypted, on-demand DynamoDB table with point-in-time recovery and
retain-on-delete/replacement policies. Profiles survive application deployments.
No TTL is applied. Account deletion/erasure is not automated in this step;
operators must also delete the matching DynamoDB record when removing an account.

The profile Lambda can only GetItem/PutItem/UpdateItem on this table and AdminGetUser
on this user pool. The session Lambda can only GetItem/PutItem on the table.
Lambda invocation permissions name API Gateway, the AWS account, and the exact
stage/method/path. There are no Function URLs or public Lambda allow policies.
CORS permits only the deployed website origin. API access logs contain request
ID, route and status, not profile bodies or tokens.

Run `npm run build`, `npm test`, then review `npm run diff -- --no-change-set`
from `infra/`. Deploy using the EC2 instance role and the existing deployment
workflow. No new secrets or mobile environment values are needed.
