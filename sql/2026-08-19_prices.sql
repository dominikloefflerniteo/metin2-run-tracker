-- =====================================================================
-- Metin2 Run-Tracker — Marktpreise und Truhenwerte
--
-- Im SQL-Editor des Projekts ausfuehren:
--   https://supabase.com/dashboard/project/ppafhxtcwyufesszhidv/sql/new
-- Wiederholbar, ein zweiter Lauf schadet nicht.
--
-- WOHER DIE DATEN KOMMEN: metin2alerts liefert keinen CORS-Header, prueft
-- Origin/Referer, signiert jeden Request in der Seite selbst und antwortet in
-- Protobuf — eine statische Seite auf GitHub Pages kommt da nicht ran. Die
-- Preise holt deshalb metin-bazar-pro auf Dominiks PC (Playwright + eigene
-- Preishistorie) und schiebt sie nach jedem Poll hier herein. Genau dasselbe
-- Muster wie bei `channels` / g-status, nur mit PC statt GitHub-Actions-Cron.
--
-- Laeuft der PC nicht, altern die Werte einfach. Deshalb traegt JEDE Zeile
-- `fetched_at`, und die Oberflaeche zeigt das Alter der Daten an.
--
-- WAEHRUNG: alle Preise sind "unified Yang" — 1 Won = 100.000.000 Yang,
-- immer pro Stueck. Anzeige: ab 100 Mio als Won, darunter als Yang.
-- =====================================================================

-- ------------------------------------------------------- Truhenwerte
-- Eine Zeile je Truhe und Server. `expected_value` ist der Erwartungswert
-- EINER Oeffnung inkl. Mehrfach-Drops (`openings`), gerechnet aus den
-- Drop-Raten und dem 7-Tage-Schnitt der guenstigsten 25 % am Markt.
create table if not exists public.chest_values (
  server         text not null,
  vnum           int  not null,
  name           text not null,
  chest_price    bigint not null default 0,   -- was die Truhe selbst kostet
  key_vnum       int,
  key_name       text,
  key_price      bigint not null default 0,   -- Schluessel, falls noetig
  expected_value bigint not null default 0,
  openings       int  not null default 1,
  drops          jsonb not null default '[]', -- Aufschluesselung, wertvollste zuerst
  priced_drops   int  not null default 0,     -- wie viele Drops einen Marktpreis hatten
  total_drops    int  not null default 0,     -- ... von wie vielen insgesamt
  fetched_at     timestamptz not null default now(),
  primary key (server, vnum)
);

-- ------------------------------------------------------ Einzelpreise
-- Nur fuer Drops, die direkt fallen (ohne Truhe). Der Push-Job holt sich die
-- Liste aus `run_loot` (kind='item') — es landen also genau die Items hier,
-- die auch wirklich bei einem Run eingetragen sind.
create table if not exists public.item_prices (
  server     text not null,
  vnum       int  not null,
  name       text not null,
  price      bigint not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (server, vnum)
);

-- --------------------------------------------------------- Run-Beute
-- Was ein Run im Schnitt abwirft. Das weiss KEINE API — das tragt ihr selbst
-- ein und korrigiert es mit der Erfahrung. Deshalb in der DB und im UI
-- aenderbar, nicht im Code.
--
--   qty     Ø Stueck pro Run, darf krumm sein (0.5 = jeder zweite Run)
--   kind    'chest' -> Erwartungswert aus chest_values
--           'item'  -> Marktpreis aus item_prices
--   is_cost true = wird abgezogen (Schluessel, Verbrauchsgueter, Eintritt)
create table if not exists public.run_loot (
  id         uuid primary key default gen_random_uuid(),
  run_key    text not null,                  -- -> run_types.key
  vnum       int  not null,
  name       text not null default '',       -- nur Anzeige, Quelle bleibt vnum
  kind       text not null default 'chest',
  qty        numeric not null default 1,
  is_cost    boolean not null default false,
  note       text not null default '',
  sort       int  not null default 0,
  by_user    text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists run_loot_run_idx on public.run_loot (run_key);

-- ------------------------------------------------- Laufzeit je Run
-- `seconds` ist der Cooldown (wann der Run wieder GEHT). Das hier ist die
-- Zeit, die der Run tatsaechlich KOSTET. Wer genug Charaktere hat, wartet nie
-- auf einen Cooldown — dann ist die eigene Zeit der Engpass, und Yang pro
-- Stunde muss darauf gerechnet werden. 0 = nicht eingetragen.
alter table public.run_types add column if not exists run_seconds int not null default 0;

-- ------------------------------------------------------------------ RLS
-- Gleiches Modell wie der Rest: anon darf alles, der Schutz ist der Key.
alter table public.chest_values enable row level security;
alter table public.item_prices  enable row level security;
alter table public.run_loot     enable row level security;

drop policy if exists chest_values_all on public.chest_values;
drop policy if exists item_prices_all  on public.item_prices;
drop policy if exists run_loot_all     on public.run_loot;

create policy chest_values_all on public.chest_values for all to anon using (true) with check (true);
create policy item_prices_all  on public.item_prices  for all to anon using (true) with check (true);
create policy run_loot_all     on public.run_loot     for all to anon using (true) with check (true);

-- -------------------------------------------------------------- Realtime
do $$
declare t text;
begin
  foreach t in array array['chest_values','item_prices','run_loot'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
