-- Nachtrag: Account je Charakter (mehrere Charaktere teilen sich einen Account).
-- Im SQL-Editor ausfuehren; schema.sql enthaelt dasselbe fuer neue Projekte.
-- Wiederholbar.

alter table public.chars
  add column if not exists account text not null default '';
