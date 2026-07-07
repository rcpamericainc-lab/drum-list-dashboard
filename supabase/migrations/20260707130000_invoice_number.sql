-- Add an invoice number to each order. Filled in later by office staff from the
-- dashboard; null until they enter it. The existing open update policy already
-- allows the app (anon role) to write it.
alter table public.orders add column invoice_number text;
