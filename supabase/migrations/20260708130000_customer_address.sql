-- Optional delivery address for an order. Some customers have multiple
-- locations, so the driver can pin down which one. Null when not specified.
alter table public.orders add column customer_address text;
