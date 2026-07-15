-- Fulfillment + returns on each item. The `items` jsonb column already accepts
-- arbitrary object shapes, so no column change is needed — each item object
-- simply gains three OPTIONAL fields, all set through the app:
--
--   fulfillment        text  -- 'fulfilled' | 'cancelled'; absent/null = pending
--   quantity_fulfilled int   -- how many reached the customer once fulfilled;
--                            -- (quantity - quantity_fulfilled) is returning
--   note               text  -- optional driver context (e.g. why some returned)
--
-- Two independent axes: `status` (stock: open/in_stock/out_of_stock, office-set)
-- is unchanged; the fields above are the fulfillment axis. Drivers set
-- fulfilled + quantity_fulfilled + note; the office sets cancelled (a soft
-- retire — there is still no hard DELETE). Existing rows have none of these and
-- read as pending, so this migration is purely additive and backfill-free.
--
-- Recorded as a column comment so the shape is documented in the database.

comment on column public.orders.items is
  'Array of line items. Each: { product_name text, quantity int, status '
  '(open|in_stock|out_of_stock), fulfillment (fulfilled|cancelled|absent=pending), '
  'quantity_fulfilled int|null, note text|null }.';
