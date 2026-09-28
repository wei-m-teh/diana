# Location sharing

Deployed September 28, 2026 for web and Android. Requires Android build 18.
Existing Cognito/Google authentication and room scoping remain unchanged.

## User flow

Profile / Settings → Location offers Off (default), Use device location, or a
manual city/region/country. Selecting device mode requests permission on that
device. Save changes to persist the account preference. Each new conversation
loads the preference and obtains one fix if device sharing is enabled.
Permission is separate on each browser/device; Android has an explicit Allow /
check button for permission that was not granted on this device. OS/browser
permission denial or a timeout falls back to the dated last-known account fix.
Neither app polls location or tracks movement during a conversation.

Both apps round latitude/longitude to two decimal places before sending them.
The API validates ranges, accuracy and capture time and rounds again. Accuracy
is reported as at least 1 km. A fresh fix may be up to 10 minutes old (OS cache),
so the agent also receives its timestamp and a dynamically computed age.
No new fix is invented from timezone, IP address or sign-in data.

The existing profile table stores one latest `lastKnownLocation`, not a location
history. It includes approximate coordinates, accuracy, capture time and city
when available. Manual city overrides device location. Saving Off or a manual
city clears the saved device fix. Account-scoped conditional writes prevent an
in-flight fix from restoring sharing after opt-out or overwriting a newer fix.
Existing table backup/PITR retention still applies; clearing the active item does
not erase historical backups. Active conversations retain their initial snapshot;
restart after a settings change. Location is not logged by the implementation.

## Backend and agent

Authenticated POST /sessions accepts an optional `deviceLocation` object. Only
an enabled server-owned profile preference permits persistence or inclusion in
signed agent dispatch metadata. The body cannot enable sharing or select another
user. Device-supplied coordinates are context, not verified physical presence.

The session Lambda uses AWS Location `geo-places:ReverseGeocode` with its execution
role, restricted to the region's `provider/default` ARN. There is no new API key,
public Lambda policy or location endpoint. The SDK uses one attempt and a
2-second request timeout; geocoder failure leaves the approximate fix available
without guessing a city. Only locality, region and country are retained; street
addresses and house numbers are discarded. `IntendedUse: Storage` is explicit
because the city is retained across conversations.

Diana receives source `device`, `last_known`, `manual` or `unavailable`. Fresh
location informs "here"/"near me" searches. Last-known location requires
confirmation before current local lookups. Manual city is a preference rather
than proof of whereabouts. Unavailable location prompts a city question.
City data is treated as untrusted content, not instructions; search queries
prefer city/region over coordinates.

## Costs and release

No new taggable AWS resources are created. Existing application tags and ECS tag
propagation remain intact. AWS Location requests add usage charges; the shared
provider ARN cannot be tagged exclusively for Diana. Audit Location Service
usage separately alongside the tagged Lambda/DynamoDB costs. Calls storing
results use AWS's Storage pricing category. Never tag shared infrastructure as
exclusively belonging to Diana.

Deploy CDK after the web static build, then install Android build 18. Verify on a
physical phone: grant location, start a conversation, ask where "here" is, end
and restart, deny location and confirm the last-known fallback, then save Off
and verify the next conversation has no location. Test manual city on one client
and verify it applies on the other. Android requests only foreground approximate
location (`ACCESS_COARSE_LOCATION`), not background location.

Validated with API persistence/auth/race tests, browser permission mocks,
Flutter session and settings tests, agent freshness tests, live-model behavior
checks and a real AWS reverse lookup using a public Seattle coordinate.

Verification completed: 30 infrastructure/API tests, 18 Flutter tests, 39 offline
agent regression tests, and two live-model location behavior tests passed. Web
static export and Android ARM64 build 18 succeeded. Device permission dialogs
and physical location acquisition still need verification on the user's phone
on the updated app. The spoken search acknowledgment was deployed alongside
this feature.

## Deployment verification — September 28, 2026

CDK deployed agent task revision 13, image
`c984707fa78d77f465efe7fabc9c0be3a30664aee8f335f315f5028cd0eab781`,
the location-aware APIs and static website. Android build 18 is in the existing
private MobileDownloads bucket. Live Lambda/DB checks with a synthetic profile
verified city lookup, coordinate rounding, cross-client fallback, manual override
and opt-out clearing; the synthetic record was deleted afterward. CloudFront
serves the exact new bundle and anonymous API requests remain rejected. Live
voice checks verified location awareness and audible search acknowledgment before
citation delivery, followed by the final spoken search answer. ECS reached a
completed rollout with service tag propagation, and the post-deploy cost-tag
verification completed successfully.
