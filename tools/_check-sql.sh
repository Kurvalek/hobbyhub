#!/usr/bin/env bash
# Scratch: run supabase/migrations/0001_init.sql against a throwaway local
# Postgres 18 cluster to prove the SQL actually executes — syntax, triggers,
# constraints, and the RLS policies. Supabase's own `auth` schema is stubbed
# below (auth.users, auth.uid(), the three roles) since we can't have the real
# one locally. Delete once the migration is signed off.
set -euo pipefail

# initdb refuses to run with an unset/odd locale, which is what the sandbox hands us.
export LC_ALL=C LANG=C

PG=/opt/homebrew/opt/postgresql@18/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Outside the repo, and space-free: postgres passes `-k <dir>` through its own
# option parser, which can't cope with the space in "My Stuff".
DATA="${TMPDIR:-/tmp}/metime-pgcheck-$$"
SOCK="$DATA/sock"

cleanup() {
  "$PG/pg_ctl" -D "$DATA" -s stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

rm -rf "$DATA"
"$PG/initdb" -D "$DATA" -U postgres --no-sync >/dev/null
mkdir -p "$SOCK"
"$PG/pg_ctl" -D "$DATA" -s -w -o "-k '$SOCK' -h '' -c fsync=off" start >/dev/null
psql() { "$PG/psql" -h "$SOCK" -U postgres -d checkdb -v ON_ERROR_STOP=1 -q "$@"; }
"$PG/createdb" -h "$SOCK" -U postgres checkdb

echo "── stubbing Supabase's auth schema ──"
psql <<'SQL'
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
-- Real Supabase reads the verified JWT; this reads a session GUC so the RLS
-- tests below can impersonate a user.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
do $$ begin
  create role anon;          exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role;  exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
SQL

echo "── running 0001_init.sql ──"
psql -f "$ROOT/supabase/migrations/0001_init.sql"
echo "   first run OK"

echo "── running it a second time (idempotency) ──"
psql -f "$ROOT/supabase/migrations/0001_init.sql"
echo "   re-run OK"

# Table privileges are granted by Supabase's own bootstrap, not by our
# migration, so grant them here before testing what RLS does on top.
psql -c "grant all on all tables in schema public to anon, authenticated, service_role;" >/dev/null

echo
echo "── structure ──"
psql -c "select tablename, rowsecurity as rls from pg_tables where schemaname='public' order by tablename;"
psql -c "select tablename, policyname, cmd, roles::text from pg_policies where schemaname='public' order by tablename, policyname;"
psql -c "select tgname, relname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not tgisinternal order by relname, tgname;"
psql -c "select indexname from pg_indexes where schemaname='public' order by indexname;"

echo "── signup trigger creates a profile ──"
psql <<'SQL'
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.com');
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'b@example.com');
SQL
psql -c "select count(*) as profiles, count(stripe_customer_id) as stripe_ids_set from public.profiles;"

echo "── type check constraint ──"
psql -c "insert into public.designs (user_id, type, data) values ('11111111-1111-1111-1111-111111111111','macrame','{}'::jsonb);" \
  && { echo "FAIL: bad craft type was accepted"; exit 1; } || echo "   bad craft type rejected (expected)"

echo "── updated_at trigger ──"
psql <<'SQL'
insert into public.designs (id, user_id, type, name, data)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','quilt','A','{"cols":4}'::jsonb);
select pg_sleep(0.05);
update public.designs set data = '{"cols":5}'::jsonb where id='33333333-3333-3333-3333-333333333333';
SQL
psql -c "select (updated_at > created_at) as updated_at_advanced from public.designs where id='33333333-3333-3333-3333-333333333333';"

echo "── unowned guest design is allowed ──"
psql -c "insert into public.designs (type, data) values ('cross-stitch','{\"w\":10}'::jsonb) returning (user_id is null) as unowned;"

echo "── RLS: user A sees only their own designs ──"
psql <<'SQL'
insert into public.designs (user_id, type, data)
values ('22222222-2222-2222-2222-222222222222','quilt','{"cols":9}'::jsonb);
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select count(*) as a_sees from public.designs;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as b_sees from public.designs;
reset role;
select count(*) as service_role_sees from public.designs;
SQL

echo "── RLS: A cannot write a row owned by B, or steal B's row ──"
psql <<'SQL'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SQL
psql <<'SQL' && { echo "FAIL: cross-user insert was accepted"; exit 1; } || echo "   cross-user insert blocked (expected)"
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.designs (user_id, type, data)
values ('22222222-2222-2222-2222-222222222222','quilt','{"cols":1}'::jsonb);
SQL
psql <<'SQL' && { echo "FAIL: reassigning own row to another user was accepted"; exit 1; } || echo "   ownership reassignment blocked (expected)"
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.designs set user_id='22222222-2222-2222-2222-222222222222'
where id='33333333-3333-3333-3333-333333333333';
SQL
psql <<'SQL'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- Deleting someone else's row is a no-op, not an error: RLS filters it out.
with d as (delete from public.designs
           where user_id='22222222-2222-2222-2222-222222222222' returning 1)
select count(*) as bs_rows_a_could_delete from d;
select count(*) as profiles_a_can_see from public.profiles;
SQL

echo "── RLS: orders are invisible to the browser (zero policies) ──"
psql <<'SQL'
insert into public.orders (shopify_order_id, order_name, status)
values ('5001', '#5001', 'new');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select count(*) as authenticated_sees_orders from public.orders;
set role anon;
select count(*) as anon_sees_orders from public.orders;
reset role;
select count(*) as service_role_sees_orders from public.orders;
SQL

echo "── order upsert preserves fulfillment progress ──"
psql <<'SQL'
update public.orders set status='printed', checklist='{"9|floss:310":true}'::jsonb
where shopify_order_id='5001';
-- Mirrors what api/_lib/orders.js sends on a Shopify redelivery: no status,
-- no checklist, no received_at in the payload.
insert into public.orders (shopify_order_id, order_name, customer_name, created_at)
values ('5001', '#5001', 'Redelivered', now())
on conflict (shopify_order_id) do update set
  order_name = excluded.order_name,
  customer_name = excluded.customer_name,
  created_at = excluded.created_at;
select status, checklist, customer_name from public.orders where shopify_order_id='5001';
SQL

echo "── bad order status rejected ──"
psql -c "update public.orders set status='in_a_box' where shopify_order_id='5001';" \
  && { echo "FAIL: bad status accepted"; exit 1; } || echo "   bad status rejected (expected)"

echo "── order_items cascade + design FK ──"
psql <<'SQL'
insert into public.order_items (order_id, position, line_item_id, title, quantity,
                                design_id, design_ref, design_found, type, bom)
select id, 0, '9', 'Baby quilt kit', 1,
       '33333333-3333-3333-3333-333333333333',
       '33333333-3333-3333-3333-333333333333', true, 'quilt', '{"type":"quilt"}'::jsonb
from public.orders where shopify_order_id='5001';
-- An unresolvable id still records what Shopify sent, via design_ref.
insert into public.order_items (order_id, position, title, quantity, design_ref, design_found)
select id, 1, 'Mystery kit', 1, 'not-a-real-design', false
from public.orders where shopify_order_id='5001';
select position, title, (design_id is not null) as fk_set, design_ref, design_found
from public.order_items order by position;
SQL
psql <<'SQL'
-- Deleting the design must not delete the order line; it just clears the FK.
delete from public.designs where id='33333333-3333-3333-3333-333333333333';
select position, (design_id is null) as fk_cleared, design_ref from public.order_items order by position;
delete from public.orders where shopify_order_id='5001';
select count(*) as items_after_order_delete from public.order_items;
SQL

echo "── auth.users cascade ──"
psql <<'SQL'
delete from auth.users where id='22222222-2222-2222-2222-222222222222';
select
  (select count(*) from public.profiles) as profiles_left,
  (select count(*) from public.designs where user_id='22222222-2222-2222-2222-222222222222') as bs_designs_left,
  (select count(*) from public.designs where user_id is null) as unowned_left;
SQL

echo
echo "ALL SQL CHECKS PASSED"
