-- Nachtrag zu einer bereits angelegten Datenbank: Anmeldung ("Regi").
-- Im SQL-Editor ausfuehren; schema.sql enthaelt dasselbe fuer neue Projekte.
-- Wiederholbar.

-- Manche Runs haben eine Anmeldung (Meley). Nur dort erscheint der Regi-Knopf.
alter table public.run_types
  add column if not exists has_registration boolean not null default false;

update public.run_types set has_registration = true where key = 'meley';

-- Der Zeitpunkt der Anmeldung haengt an derselben Zeile wie der Cooldown.
alter table public.timers
  add column if not exists registered_at timestamptz;

-- Eine Zeile kann jetzt auch NUR eine Anmeldung tragen (noch kein Cooldown),
-- deshalb darf ends_at leer sein.
alter table public.timers
  alter column ends_at drop not null;

alter table public.timers
  alter column started_at drop not null;
