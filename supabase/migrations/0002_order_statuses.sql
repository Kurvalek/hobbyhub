-- metime studio — widen the fulfillment status set.
--
-- The original four states collapsed everything between "printed" and "shipped"
-- into one step, which hid the part of the day that actually takes the longest:
-- assembling the box. Splitting that into `ready_to_pack` and `packed`, and
-- adding `on_hold` for orders waiting on a restock or a customer reply, gives
-- the dashboard the seven states it now filters on.
--
-- `on_hold` is deliberately outside the linear sequence — an order can be put on
-- hold from any step and comes back to `new` when it's released, so nothing here
-- tries to encode an order between the six pipeline states.
--
-- Safe to run more than once, and safe on a database that already has orders:
-- every existing value is still permitted by the new constraint.

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check check (status in (
    'new',
    'supplies_pulled',
    'printed',
    'ready_to_pack',
    'packed',
    'shipped',
    'on_hold'
  ));
