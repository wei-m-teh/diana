-- Diana — initial schema (Phase 1/2): profiles, plans, subscriptions,
-- user settings, and usage. Billing-ready (Stripe columns present, unused).
-- Run via the Supabase SQL editor or `supabase db push`.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Plans (entitlements). Seeded below.
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id                text primary key,            -- 'free', 'pro'
  name              text not null,
  monthly_minutes   int,                         -- quota; null = unlimited
  allows_pro_voices boolean not null default false,
  price_cents       int not null default 0,
  stripe_price_id   text                         -- null until Stripe is wired
);

insert into public.plans (id, name, monthly_minutes, allows_pro_voices, price_cents)
values
  ('free', 'Free', 30,   false, 0),
  ('pro',  'Pro',  600,  true,  0)              -- price set when Stripe is wired
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Subscriptions (1:1 with profile). Everyone starts on 'free'.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references public.profiles(id) on delete cascade,
  plan_id                text not null references public.plans(id) default 'free',
  status                 text not null default 'active',  -- active, past_due, canceled
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text
);

-- ---------------------------------------------------------------------------
-- User settings (chosen voice). voice_key mirrors agent/src/voices.py.
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  voice_key  text not null default 'delia',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Usage (one row per conversation). Quota = sum(seconds) in the period.
-- ---------------------------------------------------------------------------
create table if not exists public.usage_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  room_name  text,
  voice_key  text,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  seconds    int not null default 0
);
create index if not exists usage_sessions_user_started_idx
  on public.usage_sessions (user_id, started_at);

-- ---------------------------------------------------------------------------
-- New-user trigger: create profile + settings + free subscription on signup.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, plan_id) values (new.id, 'free')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security: users may read/write only their own rows. The token
-- service uses the service_role key, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.user_settings  enable row level security;
alter table public.usage_sessions enable row level security;
alter table public.plans          enable row level security;

-- Plans are readable by any authenticated user (for the pricing/voice UI).
drop policy if exists "plans are readable" on public.plans;
create policy "plans are readable" on public.plans
  for select to authenticated using (true);

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "own settings read" on public.user_settings;
create policy "own settings read" on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "own settings write" on public.user_settings;
create policy "own settings write" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own usage read" on public.usage_sessions;
create policy "own usage read" on public.usage_sessions
  for select using (auth.uid() = user_id);
-- Note: inserts into usage_sessions happen server-side via service_role only.
