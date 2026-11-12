-- metime studio — remember which orders were never real.
--
-- Shopify's orders/create payload already carries a `test` boolean: true for
-- anything placed through the Bogus Gateway or a payment provider in test mode.
-- Storing it means the dashboard can mark those orders instead of leaving them
-- looking exactly like a sale someone is waiting on. tools/seed-order.mjs sets
-- the same flag, so local fixtures are marked by the same mechanism rather than
-- by a second one that could disagree with it.
--
-- Defaults to false, which is the right answer for every row already in the
-- table: they predate the flag and none of them can be re-derived, so the
-- conservative reading is "treat it as real" — a real order mistakenly shown as
-- a test is the failure that loses a customer.

alter table public.orders
  add column if not exists is_test boolean not null default false;

comment on column public.orders.is_test is
  'True when Shopify reported the order as a test, or when it was seeded locally.';

-- Rows that predate the flag can't be re-derived from Shopify, with one
-- exception: example.com is reserved by RFC 2606 and can never belong to a real
-- customer, so anything addressed there is a fixture with certainty rather than
-- by guess. That covers the seeds already sitting in the queue. Everything else
-- keeps the cautious default.
update public.orders
   set is_test = true
 where is_test = false
   and customer_email ilike '%@example.com';
