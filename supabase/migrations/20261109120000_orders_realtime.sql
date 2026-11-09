-- Live office dashboard: broadcast changes to public.orders over Supabase
-- Realtime so the office sees new and updated orders without refreshing.
--
-- Realtime only delivers rows the subscriber can SELECT under RLS; the existing
-- "Anyone can read orders" policy already covers the office dashboard, so no
-- policy change is needed here.
--
-- Idempotent: only adds the table if it isn't already in the publication.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end
$$;
