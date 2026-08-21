-- =====================================================================
-- Metin2 Run-Tracker — Watchlist
--
-- Im SQL-Editor des Projekts ausfuehren; wiederholbar.
--
-- WIE DER ABGLEICH LAEUFT: die Seite sieht den Markt nie selbst (metin2alerts
-- ist fuer eine statische Seite unerreichbar). metin-bazar-pro auf Dominiks PC
-- prueft nach jedem Poll die NEU aufgetauchten Angebote gegen `watchlist` und
-- schreibt Treffer nach `watch_hits`. Der Browser zeigt sie an und schlaegt
-- Alarm — laeuft der PC nicht, gibt es keine Treffer.
-- =====================================================================

-- ------------------------------------------------------ Item-Katalog
-- Alles, was gerade am Markt liegt (~1.600 Items). Dient nur der Suche beim
-- Anlegen eines Eintrags: wonach nichts angeboten wird, kann man auch nicht
-- ueberwachen.
create table if not exists public.market_items (
  server     text not null default '[DIA] Blos',
  vnum       int  not null,
  name       text not null,
  listings   int  not null default 0,     -- wie viele Angebote gerade
  cheapest   bigint not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (server, vnum)
);
create index if not exists market_items_name_idx on public.market_items (name);

-- --------------------------------------------------------- Watchlist
-- `vnums` ist eine Liste, weil ein Wunsch mehrere Schmiedestufen umfassen
-- kann. Die Oberflaeche traegt vorerst genau eine ein — +0 und +5 sind
-- verschiedene Items, und meist will man nur eines davon.
-- `required_attrs`: [{"statId":53,"minValue":30}] — ALLE muessen erfuellt sein.
-- `max_price` in unified Yang pro Stueck (1 Won = 100.000.000), 0 = egal.
create table if not exists public.watchlist (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  vnums          int[] not null default '{}',
  required_attrs jsonb not null default '[]',
  max_price      bigint not null default 0,
  enabled        boolean not null default true,
  by_user        text not null default '',
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------- Treffer
-- `sig` beschreibt das Angebot (Item, Verkaeufer, Preis, Boni). Der eindeutige
-- Index darauf sorgt dafuer, dass dasselbe Angebot nicht zweimal gemeldet
-- wird, auch wenn es kurz verschwindet und unveraendert wiederkommt.
create table if not exists public.watch_hits (
  id         uuid primary key default gen_random_uuid(),
  watch_id   uuid references public.watchlist(id) on delete cascade,
  label      text not null default '',
  vnum       int not null,
  name       text not null default '',
  seller     text not null default '',
  price      bigint not null default 0,   -- pro Stueck, unified Yang
  yang_price bigint not null default 0,
  won_price  int not null default 0,
  quantity   int not null default 1,
  attrs      jsonb not null default '[]', -- [[statId, wert], ...]
  sig        text not null default '',
  seen       boolean not null default false,
  found_at   timestamptz not null default now()
);
create index if not exists watch_hits_found_idx on public.watch_hits (found_at desc);
create unique index if not exists watch_hits_uniq on public.watch_hits (watch_id, sig);

-- ------------------------------------------------------------------ RLS
alter table public.market_items enable row level security;
alter table public.watchlist    enable row level security;
alter table public.watch_hits   enable row level security;

drop policy if exists market_items_all on public.market_items;
drop policy if exists watchlist_all    on public.watchlist;
drop policy if exists watch_hits_all   on public.watch_hits;

create policy market_items_all on public.market_items for all to anon using (true) with check (true);
create policy watchlist_all    on public.watchlist    for all to anon using (true) with check (true);
create policy watch_hits_all   on public.watch_hits   for all to anon using (true) with check (true);

-- -------------------------------------------------------------- Realtime
do $$
declare t text;
begin
  foreach t in array array['market_items','watchlist','watch_hits'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
