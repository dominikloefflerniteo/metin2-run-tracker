-- =====================================================================
-- Metin2 Run-Tracker — Supabase-Schema
--
-- Einmalig im SQL-Editor des Projekts ausfuehren:
--   https://supabase.com/dashboard/project/ppafhxtcwyufesszhidv/sql/new
--
-- Das Skript ist wiederholbar (IF NOT EXISTS / DROP POLICY IF EXISTS),
-- ein zweiter Lauf schadet also nicht.
--
-- ZUGRIFFSMODELL: bewusst "jeder darf alles". Die Rolle `anon` (das ist der
-- publishable key im Browser) darf lesen und schreiben. Der Schutz ist, dass
-- der Key nicht im oeffentlichen Repo steht, sondern einmalig in der App
-- eingefuegt wird. Wer den Key hat, ist drin — so gewollt.
-- =====================================================================

-- ------------------------------------------------------------ Charaktere
create table if not exists public.chars (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  server      text not null default 'Tigerghost',
  owner       text not null default '',        -- Name aus dem Login-Gate
  note        text not null default '',
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists chars_server_idx on public.chars (server);

-- ---------------------------------------------------------------- Timer
-- Ein aktiver Timer pro Char und Run-Typ. Neu starten = upsert auf den
-- Konflikt (char_id, run_key), es entsteht also nie ein Duplikat.
create table if not exists public.timers (
  id          uuid primary key default gen_random_uuid(),
  char_id     uuid not null references public.chars(id) on delete cascade,
  run_key     text not null,
  started_at  timestamptz,
  ends_at     timestamptz,              -- leer = kein laufender Cooldown
  registered_at timestamptz,            -- Zeitpunkt der Anmeldung ("Regi")
  by_user     text not null default '',
  updated_at  timestamptz not null default now(),
  unique (char_id, run_key)
);
create index if not exists timers_ends_idx on public.timers (ends_at);

-- ------------------------------------------------------------- Run-Typen
-- Dauern sind Vorgabewerte und im UI aenderbar; sie liegen in der DB, damit
-- eine Korrektur fuer alle gilt.
create table if not exists public.run_types (
  key         text primary key,
  label       text not null,
  seconds     int  not null,
  from_start  boolean not null default false,  -- true = Cooldown laeuft ab Betreten statt ab Abschluss
  color       text not null default '#3aaac1',
  has_registration boolean not null default false,  -- Run mit Anmeldung (Meley)
  sort        int  not null default 0,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);

insert into public.run_types (key, label, seconds, from_start, color, has_registration, sort) values
  ('hydra',  'Hydra',      20*60,   true,  '#e0574f', false, 10),
  ('nemere', 'Nemere',     4*3600,  false, '#6aa9ff', false, 20),
  ('jotun',  'Jotun',      2*3600,  false, '#7ad0c8', false, 30),
  ('meley',  'Meley',      3*3600,  false, '#c9a227', true,  40),
  ('sechs7', '6/7 Bonus',  24*3600, false, '#9a7fd1', false, 50),
  ('bio',    'Bio',        24*3600, false, '#6fbf6f', false, 60)
on conflict (key) do nothing;

-- ------------------------------------------------------------- Channels
-- Wird vom GitHub-Actions-Cron (tools/fetch-gstatus.mjs) befuellt.
-- last_restart ist bewusst TEXT: g-status zeigt Serverzeit ohne Zonenangabe.
-- Als timestamptz muesste man eine Zone raten. Fuer die Spawn-Rechnung zaehlt
-- ohnehin nur Minute:Sekunde, und die ist zonenunabhaengig (Offsets sind volle
-- Stunden). Angezeigt wird der Wert deshalb als "Serverzeit".
create table if not exists public.channels (
  server        text not null,
  channel       text not null,
  status        text not null default 'unknown',
  last_restart  text,
  fetched_at    timestamptz not null default now(),
  primary key (server, channel)
);

-- ------------------------------------------------------------------ RLS
alter table public.chars     enable row level security;
alter table public.timers    enable row level security;
alter table public.run_types enable row level security;
alter table public.channels  enable row level security;

drop policy if exists chars_all     on public.chars;
drop policy if exists timers_all    on public.timers;
drop policy if exists run_types_all on public.run_types;
drop policy if exists channels_all  on public.channels;

create policy chars_all     on public.chars     for all to anon using (true) with check (true);
create policy timers_all    on public.timers    for all to anon using (true) with check (true);
create policy run_types_all on public.run_types for all to anon using (true) with check (true);
create policy channels_all  on public.channels  for all to anon using (true) with check (true);

-- -------------------------------------------------------------- Realtime
-- Ohne das kommen Aenderungen nicht per WebSocket bei den anderen an.
-- (idempotent: ein zweiter Lauf wuerde sonst mit "is already member" abbrechen)
do $$
declare t text;
begin
  foreach t in array array['chars','timers','run_types','channels'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
