# Diana — Supabase setup

Auth (Google + email) and the Postgres database for users, voices, plans, and
usage. See [`../DESIGN.md`](../DESIGN.md) for the overall architecture.

## 1. Create the project

1. Create a free project at https://supabase.com.
2. From **Project Settings → API**, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never ship to a client)

## 2. Apply the schema

Run [`migrations/0001_init.sql`](./migrations/0001_init.sql) — either paste it
into the Supabase **SQL editor** and run, or with the Supabase CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

This creates `plans`, `profiles`, `subscriptions`, `user_settings`,
`usage_sessions`, RLS policies, and a trigger that provisions a profile +
default settings + free subscription whenever a user signs up.

## 3. Enable auth providers

In **Authentication → Providers**:
- **Email**: enabled by default (magic link or password — your choice).
- **Google**: enable it and add your Google OAuth client ID/secret
  (create them in the Google Cloud console). Add redirect URLs:
  - `http://localhost:3000/auth/callback` (web dev)
  - your production web URL `/auth/callback`
  - the mobile deep-link / redirect used by `supabase_flutter`

In **Authentication → URL Configuration**, set the Site URL and any additional
redirect URLs for web and mobile.

## 4. Wire the env vars

Add the three values from step 1 to `web/.env.local` (see
[`../web/.env.example`](../web/.env.example)). The mobile app uses the URL +
anon key (public) for sign-in; the service role key stays only on the server
(token service, and later the metering writer).

## What's scaffolded vs remaining

**Scaffolded (this branch):**
- Schema + RLS + new-user trigger (`migrations/0001_init.sql`)
- Server/browser Supabase clients (`web/lib/supabase/*`)
- Authenticated token service (`web/app/api/connection-details/route.ts`) —
  enforces voice entitlement + usage quota, dispatches the chosen voice
- Shared voice catalog (`web/lib/voices.ts` mirrors `agent/src/voices.py`)

**Remaining (needs the live project to build/test):**
- Web sign-in UI + `/auth/callback` route + middleware session refresh
- Point the web session to `POST /api/connection-details` (replacing the dev
  `/api/token`) and send the auth token
- Voice-picker UI saving to `user_settings.voice_key`
- Mobile: `supabase_flutter` sign-in; attach `Authorization: Bearer <token>` to
  the `EndpointTokenSource` (it already supports custom headers)
- Phase 4: usage metering (LiveKit webhook → `usage_sessions`)
- Phase 5: Stripe (schema already supports it)
