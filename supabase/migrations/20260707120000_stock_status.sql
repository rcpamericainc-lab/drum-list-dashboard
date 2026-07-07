-- Rework order "status" from an approval lifecycle (pending/confirmed/
-- fulfilled/cancelled) into a stock/availability state the office sets:
--   open         — default when an order comes in; awaiting an office decision
--   in_stock     — proceeds on its original delivery date
--   out_of_stock — moved to the following week's delivery date (the app shifts
--                  delivery_date + order_week by 7 days when this is set)
-- No-cutoff routes (4, 6, 14) are set to in_stock at intake by the app.
--
-- Existing rows are remapped (confirmed/fulfilled -> in_stock, everything else
-- -> open). This is a lossy, one-way change; it is safe here because the tool
-- only holds low-stakes internal test data.

-- Drop the old default so the type swap isn't blocked by it.
alter table public.orders alter column status drop default;

create type public.order_stock_status as enum (
  'open',
  'in_stock',
  'out_of_stock'
);

alter table public.orders
  alter column status type public.order_stock_status
  using (
    case status::text
      when 'confirmed' then 'in_stock'
      when 'fulfilled' then 'in_stock'
      else 'open'
    end::public.order_stock_status
  );

alter table public.orders alter column status set default 'open';

-- The old enum is now unused.
drop type public.order_status;
