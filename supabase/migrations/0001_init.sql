-- metime studio — full schema (accounts, saved designs, fulfillment queue).
--
-- Run this whole file once in the Supabase dashboard: SQL Editor → New query →
-- paste → Run. It is written to be re-runnable: every object uses
-- `if not exists` / `create or replace` / `drop policy if exists`, so pasting it
-- again after an edit is safe and non-destructive to existing rows.
--
-- Auth itself lives in Supabase's own `auth.users` (email 6-digit OTP). Nothing
-- here stores passwords or codes.

-- gen_random_uuid() lives in pgcrypto. Supabase projects normally have it
-- already; this is a no-op if so.
create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────────────────
-- profiles — one row per auth user, our own columns hang off it.
-- `stripe_customer_id` is reserved for later; Stripe is NOT wired up yet and is
-- never the login. It stays null until checkout is built.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text,
  stripe_customer_id text,
  created_at         timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- designs — a saved quilt / cross-stitch / punch-needle project.
--
-- `user_id` is NULLABLE on purpose. A guest can buy a kit without an account:
-- the studio POSTs the design unowned so the Shopify order has something to
-- point at. Signing in and saving is what attaches a user_id.
--
-- The uuid IS the capability: /api/designs/[id] serves any design by id so a
-- purchased kit stays resolvable for fulfillment even though the buyer may not
-- be the design's owner. 122 bits of entropy, never listed publicly.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.designs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete cascade,
  type       text not null check (type in ('quilt', 'cross-stitch', 'punch-needle')),
  name       text,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The studio's only list query: this user's designs, newest edit first.
create index if not exists designs_user_updated_idx
  on public.designs (user_id, updated_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- orders — the fulfillment queue the admin dashboard reads. One row per
-- Shopify order. Shipping is flattened into columns (the dashboard re-nests it)
-- so it stays queryable.
--
-- `shopify_order_id` is unique because Shopify re-delivers webhooks; the
-- webhook upserts on it and deliberately preserves status/checklist/received_at
-- so a redelivery never resets fulfillment progress.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  shopify_order_id  text not null unique,
  order_name        text,
  customer_name     text,
  customer_email    text,
  ship_name         text,
  ship_address1     text,
  ship_address2     text,
  ship_city         text,
  ship_province     text,
  ship_zip          text,
  ship_country      text,
  status            text not null default 'new'
                      check (status in ('new', 'supplies_pulled', 'printed', 'shipped')),
  -- Per-supply "pulled" ticks, keyed "<lineItemId>|<supplyKey>" by admin.html.
  checklist         jsonb not null default '{}'::jsonb,
  -- Shopify's own order timestamp; the queue sorts on this.
  created_at        timestamptz not null default now(),
  received_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists orders_created_idx on public.orders (created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- order_items — the purchased line items, with the resolved design and its
-- computed supply BOM frozen in at webhook time (so a later edit to the design
-- can't silently change what we already promised to ship).
--
-- Two design columns on purpose:
--   design_id  — FK, set only when the design actually resolved.
--   design_ref — the raw id Shopify sent, kept even when it resolves to nothing
--                so the dashboard can show "design not found for id X". An FK
--                alone can't hold an id that doesn't exist.
-- `position` preserves line-item order, which the checklist keys depend on when
-- a line item has no id.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  position      int not null default 0,
  line_item_id  text,
  title         text,
  variant_title text,
  quantity      int not null default 1,
  sku           text,
  design_id     uuid references public.designs (id) on delete set null,
  design_ref    text,
  design_found  boolean not null default false,
  type          text,
  bom           jsonb
);

create index if not exists order_items_order_idx
  on public.order_items (order_id, position);

-- ───────────────────────────────────────────────────────────────────────────
-- updated_at maintenance
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists designs_touch_updated_at on public.designs;
create trigger designs_touch_updated_at
  before update on public.designs
  for each row execute function public.touch_updated_at();

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- Profile autocreation. Runs as the definer because the trigger fires inside
-- Supabase's auth schema, where the caller has no rights on public.profiles.
-- `on conflict do nothing` keeps a re-signup idempotent.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any users who signed up before this migration ran.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- RLS is on for every table. The service role key used by the server endpoints
-- bypasses RLS entirely — that key must never reach the browser. Everything
-- below governs what the browser's anon key (and a signed-in user's JWT) can do.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.profiles    enable row level security;
alter table public.designs     enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- profiles: read and update your own row, nothing else. No insert policy —
-- rows come only from the signup trigger.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- designs: a signed-in user sees and touches only their own rows. The
-- `with check` on insert/update is what stops someone writing a row owned by
-- (or reassigning a row to) another user.
--
-- Note there is deliberately NO policy for the `anon` role: unowned
-- guest-checkout designs and the by-id capability read both go through the
-- server's service-role client, never straight from the browser.
drop policy if exists "designs_select_own" on public.designs;
create policy "designs_select_own" on public.designs
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "designs_insert_own" on public.designs;
create policy "designs_insert_own" on public.designs
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "designs_update_own" on public.designs;
create policy "designs_update_own" on public.designs
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "designs_delete_own" on public.designs;
create policy "designs_delete_own" on public.designs
  for delete to authenticated
  using (auth.uid() = user_id);

-- orders / order_items: no client access at all. RLS is enabled and zero
-- policies exist, so anon and authenticated are both denied everything. Only
-- the service role (webhook + admin endpoints) can read or write them.
