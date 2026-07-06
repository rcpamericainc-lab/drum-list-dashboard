create type public.app_role as enum ('driver', 'office');

create type public.order_status as enum (
  'pending',
  'confirmed',
  'fulfilled',
  'cancelled'
);

create table public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.driver_trucks (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  truck_number text not null,
  created_at timestamptz not null default now(),
  unique (driver_id, truck_number)
);

create table public.cutoff_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Default weekly cutoff',
  cutoff_day int not null check (cutoff_day between 0 and 6),
  cutoff_time time not null,
  timezone text not null default 'America/New_York',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index cutoff_rules_one_active_idx
on public.cutoff_rules ((active))
where active;

insert into public.cutoff_rules (cutoff_day, cutoff_time)
values (4, '17:00');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  truck_number text not null,
  product_name text not null,
  customer_name text not null,
  date_needed date not null,
  status public.order_status not null default 'pending',
  driver_id uuid not null references public.drivers(id) on delete restrict,
  created_at timestamptz not null default now(),
  order_week date not null
);

create index orders_driver_id_idx on public.orders(driver_id);
create index orders_truck_number_idx on public.orders(truck_number);
create index orders_status_idx on public.orders(status);
create index orders_order_week_idx on public.orders(order_week);
create index orders_created_at_idx on public.orders(created_at);

alter table public.user_profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.driver_trucks enable row level security;
alter table public.cutoff_rules enable row level security;
alter table public.orders enable row level security;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.user_profiles
  where auth_user_id = auth.uid()
$$;

create or replace function public.current_driver_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.drivers
  where auth_user_id = auth.uid()
$$;

create policy "Users can read own profile"
on public.user_profiles
for select
to authenticated
using (auth_user_id = auth.uid() or public.current_app_role() = 'office');

create policy "Office can manage profiles"
on public.user_profiles
for all
to authenticated
using (public.current_app_role() = 'office')
with check (public.current_app_role() = 'office');

create policy "Drivers can read own driver profile"
on public.drivers
for select
to authenticated
using (auth_user_id = auth.uid() or public.current_app_role() = 'office');

create policy "Office can manage drivers"
on public.drivers
for all
to authenticated
using (public.current_app_role() = 'office')
with check (public.current_app_role() = 'office');

create policy "Drivers can read own truck assignments"
on public.driver_trucks
for select
to authenticated
using (
  driver_id = public.current_driver_id()
  or public.current_app_role() = 'office'
);

create policy "Office can manage truck assignments"
on public.driver_trucks
for all
to authenticated
using (public.current_app_role() = 'office')
with check (public.current_app_role() = 'office');

create policy "Authenticated users can read active cutoff rules"
on public.cutoff_rules
for select
to authenticated
using (active = true or public.current_app_role() = 'office');

create policy "Office can manage cutoff rules"
on public.cutoff_rules
for all
to authenticated
using (public.current_app_role() = 'office')
with check (public.current_app_role() = 'office');

create policy "Drivers can read own orders and office can read all"
on public.orders
for select
to authenticated
using (
  driver_id = public.current_driver_id()
  or public.current_app_role() = 'office'
);

create policy "Drivers can create own orders"
on public.orders
for insert
to authenticated
with check (
  driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.driver_trucks
    where driver_trucks.driver_id = public.current_driver_id()
      and driver_trucks.truck_number = orders.truck_number
  )
);

create policy "Office can update all orders"
on public.orders
for update
to authenticated
using (public.current_app_role() = 'office')
with check (public.current_app_role() = 'office');
