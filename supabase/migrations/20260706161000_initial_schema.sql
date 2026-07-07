-- FleetView order intake — no-auth model.
-- The app has no login. It talks to Supabase with the public anon key, so the
-- tables below are intentionally open to the `anon` (and `authenticated`) roles.
-- Anyone who can reach the app URL can read/write orders. This is a deliberate
-- choice for a small internal tool; do not store sensitive data here.

create type public.order_status as enum (
  'pending',
  'confirmed',
  'fulfilled',
  'cancelled'
);

-- Admin-editable weekly cutoff. Exactly one active rule at a time.
create table public.cutoff_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Default weekly cutoff',
  cutoff_day int not null check (cutoff_day between 0 and 6), -- 0=Sun .. 6=Sat
  cutoff_time time not null,
  timezone text not null default 'America/New_York',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index cutoff_rules_one_active_idx
  on public.cutoff_rules ((active))
  where active;

-- Seed: Thursday 5:00 PM Eastern
insert into public.cutoff_rules (cutoff_day, cutoff_time)
values (4, '17:00');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  route_number text not null,
  driver_name text,               -- optional: who placed the order
  product_name text not null,
  customer_name text not null,
  date_needed date not null,
  status public.order_status not null default 'pending',
  order_week date not null,       -- Monday of the computed order week
  created_at timestamptz not null default now()
);

create index orders_route_number_idx on public.orders(route_number);
create index orders_status_idx on public.orders(status);
create index orders_order_week_idx on public.orders(order_week);
create index orders_created_at_idx on public.orders(created_at);

-- ---------------------------------------------------------------------------
-- Open access (no auth). RLS stays ON, with explicit permissive policies so the
-- access grant is intentional and auditable rather than implicit.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.orders to anon, authenticated;
grant select, insert, update on public.cutoff_rules to anon, authenticated;

alter table public.orders enable row level security;
alter table public.cutoff_rules enable row level security;

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

create policy "Anyone can read cutoff rules"
  on public.cutoff_rules for select
  to anon, authenticated
  using (true);

create policy "Anyone can manage cutoff rules"
  on public.cutoff_rules for all
  to anon, authenticated
  using (true)
  with check (true);
