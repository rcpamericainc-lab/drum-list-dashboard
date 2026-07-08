-- Multi-product orders. Replace the single product_name with an `items` array
-- of { product_name, quantity } objects, so one order can hold several products
-- with their own quantities. Existing orders become a single line item, qty 1.
alter table public.orders
  add column items jsonb not null default '[]'::jsonb;

update public.orders
  set items = jsonb_build_array(
    jsonb_build_object('product_name', product_name, 'quantity', 1)
  )
  where product_name is not null;

alter table public.orders drop column product_name;
