# Google sign-in for any Google account

Status: deployed in AWS. Google is enabled alongside Cognito email/password
for both web and mobile clients. The Google client secret is stored in
Secrets Manager as diana/google-oauth.

Both web and mobile already open Cognito managed login with authorization code
and PKCE. Enabling Google on their Cognito clients adds the Google choice there;
neither client needs a new build. Cognito still issues the access token, and
API Gateway still validates its issuer, approved client ID and session scope.
The Lambda remains restricted to the API Gateway service principal.

## Google Cloud setup

1. Create/configure a Google Auth Platform project and its consent screen.
2. Set the audience to **External**, and publish it **In production** for access
   by external Google accounts. Complete any Google-required branding/verification.
   Diana requests only openid, email and profile. Google documents an exception
   for these basic sign-in scopes: Testing mode does not require users to be
   on the test-user list. The current integration can therefore be tested while
   the Google console publishing/branding issue is investigated.
3. Create an OAuth client of type **Web application**. Cognito is the Google
   OAuth client for both Diana web and mobile; separate Google Android/iOS
   OAuth clients are not needed for this browser-based flow.
4. Add this exact authorized redirect URI:

   ```text
   https://diana-602900100639-us-east-1.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
   ```

5. Keep the Google client ID and client secret. Store the secret in an existing
   Secrets Manager secret in us-east-1 as JSON with a `client_secret` field.
   Do not put it into web/mobile .env, source code, chat or shell arguments.

The EC2 instance role handles AWS deployment permissions. It does not grant
access to configure a Google Cloud project.

## Configure and deploy

Set both public deployment settings in ignored infra/.env:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_SECRET_ARN=arn:aws:secretsmanager:us-east-1:602900100639:secret:diana/google-oauth-XXXXXX
```

CDK references the JSON secret through a CloudFormation dynamic reference;
it does not read the value into the synthesized template. The CloudFormation
execution role needs access to that secret (and decrypt access for a custom KMS
key, if used). Changing a secret alone does not automatically update Cognito;
coordinate rotation with an identity-provider update.

Run infra typecheck/tests, review cdk diff, then deploy through the EC2 profile.
The diff should add a Google identity provider and enable Google alongside
COGNITO on both existing clients. It must not introduce a Function URL or public
Lambda permissions. Supply both settings or neither; partial settings fail
before synthesis.

## Access behavior and validation

- Any Google account may join Diana on its first successful federated sign-in.
  No domain, email allowlist or approval trigger is configured.
- Local email/password self-registration remains disabled. This does not stop
  creation of federated users.
- Existing local accounts are not automatically linked to Google by matching
  email. Account linking, if needed, must verify ownership of both accounts.
- Confirm the Google choice appears in both clients' managed login pages.
- Validate first sign-in with a new Google user, the callback, a conversation
  and logout on web and Android. Google interactive sign-in is not verified
  until real credentials are configured and a Google user completes the flow.
- Confirm anonymous API calls still return 401, and successful calls receive
  Cognito-issued access tokens rather than Google tokens.

References:
- [AWS: adding social sign-in](https://docs.aws.amazon.com/cognito/latest/developerguide/tutorial-create-user-pool-social-idp.html)
- [Google: managing app audience](https://support.google.com/cloud/answer/15549945?hl=en)
