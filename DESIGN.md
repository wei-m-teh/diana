# Diana — productization design

Plan to take Diana from prototype to a sign-up, monetizable product. Stack
decision: **Supabase** (auth + Postgres) and **Stripe** for payments, with the
schema built **billing-ready now** and the Stripe integration **deferred**.

## Goals

- Users sign up / sign in with **Google or email** (web + mobile).
- Users **choose a voice**; their choice persists and drives the agent.
- **Usage is metered** per user and capped by plan (protects margin: each
  conversation minute costs ~$0.04–0.05 in model fees).
- **Billing-ready**: plans, entitlements, and usage modeled now; Stripe wired
  later with no schema change.

## Architecture

```
 web (Next.js)              mobile (Flutter)
      │  Supabase Auth (Google/email) → access token (JWT)
      ▼                               ▼
 ┌──────────────────── Token service (authenticated) ────────────────────┐
 │  • verify Supabase JWT                                                 │
 │  • load user's voice + plan + month-to-date usage                     │
 │  • enforce: voice tier allowed? quota remaining?                      │
 │  • mint LiveKit token w/ agent dispatch + metadata {voice, user_id}   │
 └───────────────┬───────────────────────────────────┬───────────────────┘
                 │ token                               │ usage writes
                 ▼                                     ▼
        LiveKit Cloud (room) ── deployed agent ──▶ Supabase (usage_sessions)
                 │              reads voice from metadata,
                 ▼              renders chosen TTS
            user talks to Diana
```

Key change already implemented (this branch): the **agent reads its voice from
dispatch metadata** (`agent/src/voices.py` + `agent/src/agent.py`), falling back
to a default. Voice catalog is the source of truth and defines `free`/`pro`
tiers.

## Data model (Supabase Postgres)

All tables protected with Row-Level Security (RLS): a user can read/write only
their own rows; the token service uses the service role to bypass RLS.

```sql
-- extends auth.users (Supabase-managed)
profiles(
  id uuid pk references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz default now()
)

plans(
  id text pk,                 -- 'free', 'pro'
  name text,
  monthly_minutes int,        -- quota; null = unlimited
  allows_pro_voices bool,
  price_cents int,            -- 0 for free
  stripe_price_id text        -- null until Stripe is wired
)

subscriptions(
  user_id uuid pk references profiles(id) on delete cascade,
  plan_id text references plans(id) default 'free',
  status text default 'active',          -- active, past_due, canceled
  current_period_start timestamptz,
  current_period_end timestamptz,
  stripe_customer_id text,               -- null until Stripe
  stripe_subscription_id text
)

user_settings(
  user_id uuid pk references profiles(id) on delete cascade,
  voice_key text default 'delia',        -- mirrors voices.py keys
  updated_at timestamptz default now()
)

usage_sessions(
  id uuid pk default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  room_name text,
  voice_key text,
  started_at timestamptz,
  ended_at timestamptz,
  seconds int                            -- billable duration
)
```

Quota check = `sum(seconds) in current period` vs `plans.monthly_minutes * 60`.
New users get a `profiles` + `user_settings` + `subscriptions(plan='free')` row
via a Postgres trigger on `auth.users` insert.

## Token service (replaces the dev `/api/token`)

The current `web/app/api/token/route.ts` is **dev-only and unauthenticated** —
it must be replaced (or gated) before launch. The production endpoint:

1. Requires `Authorization: Bearer <supabase access token>`; verify it.
2. Look up `user_settings.voice_key` and the user's plan.
3. Entitlement: if the voice is `pro` and the plan disallows pro voices, either
   downgrade to default or return 403.
4. Quota: if month-to-date usage ≥ plan minutes, return 402/403.
5. Mint a LiveKit token with `roomJoin` and a `RoomConfiguration` agent dispatch
   for `diana` with `metadata = {"voice": <voice_key>, "user_id": <id>}`.
6. Return `{ serverUrl, participantToken, roomName }` (standard endpoint format),
   so both the web app and the Flutter `EndpointTokenSource` work unchanged —
   the clients just need to send the auth header.

Both frontends already support custom headers on their token source, so the only
client change is attaching the signed-in user's token.

## Usage metering

Record one `usage_sessions` row per conversation. Two options:

- **LiveKit webhooks (recommended):** subscribe to `room_finished` /
  participant events → a backend handler computes duration and writes the row.
  Reliable even if the agent crashes.
- **Agent-side:** on session end, the agent POSTs duration to a backend endpoint
  (service-authenticated). Simpler but less robust.

Quota is enforced at **token issue** time (pre-session). A long single session
can overshoot; acceptable for v1, revisit with mid-session limits if needed.

## Voice selection (end to end)

1. `agent/src/voices.py` — catalog + `free`/`pro` tiers (**done**).
2. Web/mobile **voice picker** lists `VOICES`, gating `pro` voices by plan;
   saves to `user_settings.voice_key`.
3. Token service puts the chosen voice in dispatch metadata.
4. Agent renders it (**done**).

Keep the picker's list in sync with `voices.py` (later: expose it from a small
`/api/voices` endpoint or shared config so there's one source of truth).

## Deployment

- **Agent** → deploy to LiveKit Cloud (`lk agent create`) so it's always-on (the
  only point the $0.01/min agent-session fee applies). Reads Supabase service
  credentials for any server-side writes.
- **Web + token service** → Vercel (Next.js).
- **Mobile** → Play Store / App Store (later).

## Phased roadmap

1. **Auth** — Supabase project; Google + email; sign-in in web + mobile;
   `profiles`/`user_settings`/`subscriptions` tables + new-user trigger.
2. **Secure token service** — authenticated endpoint with voice metadata +
   entitlement + quota; clients send the auth header; retire the dev route.
3. **Voice selection UX** — picker in web + mobile; deploy the agent to Cloud.
   (Agent-side voice handling already done.)
4. **Metering + quotas** — `usage_sessions` via LiveKit webhooks; enforce caps.
5. **Payments (deferred)** — Stripe Checkout + customer portal; webhook updates
   `subscriptions`. Schema already supports it (`stripe_*`, `plans.price_cents`).

## Security cleanup before launch

- Remove the dev-only `/api/token` (or hard-gate to non-production).
- Remove `android:usesCleartextTraffic="true"` from the mobile app; point it at
  the **https** production token endpoint.
- Add Supabase RLS policies on all tables.
- Never ship the LiveKit API secret or Supabase service key to a client; both
  live only in the backend/token service and the deployed agent.
