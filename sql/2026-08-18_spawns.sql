-- Nachtrag: eigene Spawns mit Beschriftung ("Metins Wald CH1", jede Stunde :39:30).
-- Im SQL-Editor ausfuehren; schema.sql enthaelt dasselbe fuer neue Projekte.
-- Wiederholbar.

create table if not exists public.spawns (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  minute      int  not null default 0,        -- Minute im Takt
  second      int  not null default 0,
  period_sec  int  not null default 3600,     -- Abstand, Vorgabe stuendlich
  sort        int  not null default 0,
  by_user     text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.spawns enable row level security;
drop policy if exists spawns_all on public.spawns;
create policy spawns_all on public.spawns for all to anon using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'spawns'
  ) then
    alter publication supabase_realtime add table public.spawns;
  end if;
end $$;
