-- Nachtrag: "wer ist gerade auf dem Charakter eingeloggt".
-- Im SQL-Editor ausfuehren; schema.sql enthaelt dasselbe fuer neue Projekte.
-- Wiederholbar.
--
-- Bewusst am Charakter und nicht in einer eigenen Tabelle: es gibt immer nur
-- einen aktuellen Zustand, keine Historie.

alter table public.chars
  add column if not exists logged_in_by text,
  add column if not exists logged_in_at timestamptz;
