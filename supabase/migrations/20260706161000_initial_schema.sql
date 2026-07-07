-- FleetView order intake — no-auth model.
-- The app has no login. It talks to Supabase with the public anon key, so the
-- tables below are intentionally open to the `anon` (and `authenticated`) roles.
-- Anyone who can reach the app URL can read/write orders. This is a deliberate
-- choice for a small internal tool; do not store sensitive data here.

-- ---------------------------------------------------------------------------
-- Clean slate. Drops any prior schema (including the earlier auth-based tables)
-- so this file can be re-run to reconcile the database. This is safe ONLY
-- because there is no production data yet — remove this block before you have
-- real orders you care about.
-- ---------------------------------------------------------------------------
drop table if exists public.orders cascade;
drop table if exists public.driver_trucks cascade;
drop table if exists public.drivers cascade;
drop table if exists public.user_profiles cascade;
drop table if exists public.cutoff_rules cascade;
drop function if exists public.current_app_role() cascade;
drop function if exists public.current_driver_id() cascade;
drop type if exists public.app_role cascade;
drop type if exists public.order_status cascade;

create type public.order_status as enum (
  'pending',
  'confirmed',
  'fulfilled',
  'cancelled'
);

-- Per-route cutoff rules live in code (src/lib/routes.ts), so there is no
-- cutoff table. Each order stores the computed order_week + delivery_date.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique default gen_random_uuid(), -- for offline-queue idempotency
  route_number text not null,
  driver_name text,               -- optional: who placed the order
  product_name text not null,
  customer_name text not null,
  date_needed date not null,
  status public.order_status not null default 'pending',
  order_week date not null,       -- Monday of the computed order week
  delivery_date date,             -- computed delivery date; null for no-cutoff routes
  created_at timestamptz not null default now()
);

create index orders_route_number_idx on public.orders(route_number);
create index orders_status_idx on public.orders(status);
create index orders_order_week_idx on public.orders(order_week);
create index orders_delivery_date_idx on public.orders(delivery_date);
create index orders_created_at_idx on public.orders(created_at);

-- ---------------------------------------------------------------------------
-- Open access (no auth). RLS stays ON, with explicit permissive policies so the
-- access grant is intentional and auditable rather than implicit.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.orders to anon, authenticated;

alter table public.orders enable row level security;

create policy "Anyone can read orders"
  on public.orders for select
  to anon, authenticated
  using (true);

create policy "Anyone can create orders"
  on public.orders for insert
  to anon, authenticated
  with check (true);

create policy "Anyone can update orders"
  on public.orders for update
  to anon, authenticated
  using (true)
  with check (true);
-- Note: no DELETE policy. Orders are retired via the 'cancelled' status.
