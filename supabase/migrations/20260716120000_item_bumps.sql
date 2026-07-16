-- "Bumps" — how many times the office has pushed an item forward. Each time an
-- item is marked out of stock it moves one unit later (a day for routes 4/6/14,
-- a week for the rest) and its status returns to 'open', so it can be pushed
-- again. The scheduled date is derived as the original date shifted by `bumps`;
-- the original is kept (bumps 0) for the struck-through "was" date.
--
-- Stored inside the existing items jsonb, so no column or permission change —
-- each item object gains one more OPTIONAL field:
--
--   bumps  int  -- times pushed forward; absent/0 = on the original date
--
-- Existing rows have no `bumps` and read as 0, so this is additive only.
--
-- Legacy data: the old model left items resting on status 'out_of_stock' to
-- mean "moved one week." The app's normalizeItems() converts any such item to
-- status 'open' + one extra bump on read, and persists that shape the next time
-- the order is saved — so old out-of-stock rows migrate lazily, no bulk update
-- required here.
--
-- Recorded as a column comment so the shape is documented in the database.

comment on column public.orders.items is
  'Array of line items. Each: { product_name text, quantity int, status '
  '(open|in_stock|out_of_stock), bumps int|null (times pushed forward; 0=original '
  'date), fulfillment (fulfilled|cancelled|absent=pending), quantity_fulfilled '
  'int|null, note text|null }.';
