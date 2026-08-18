# Änderungen

Neuestes zuerst. Die oberste Nummer muss mit `version.js` übereinstimmen —
der Smoketest prüft das.

## 0.7.0 — 2026-08-18
Notizen, Account, Gruppierung nach Login

- Eigene **Notizen-Spalte** zwischen Charakter und den Runs, direkt in der
  Tabelle beschreibbar (speichert beim Verlassen des Feldes).
- **Account** je Charakter (im Bearbeiten-Fenster).
- Umschalter **nach Spieler / nach Account** statt der Checkbox.
- „Nach Spieler" gruppiert jetzt nach dem **eingeloggten** Spieler; wer nicht
  eingeloggt ist, steht unter **Nicht eingeloggt** am Ende der Liste.
- Versionsanzeige oben links, gekoppelt an CHANGELOG.md (der Smoketest prüft,
  dass beide dieselbe Nummer nennen).

## 0.6.1 — 2026-08-18
Login speichert wieder (Teiländerung statt Upsert)

- `DB.setLogin` schickte eine Teiländerung als Upsert; PostgREST macht daraus
  `INSERT … ON CONFLICT`, und Postgres prüft `NOT NULL` schon beim Bilden der
  Zeile → *null value in column "name"*. Neuer `patch()`-Helfer mit echtem
  `UPDATE … WHERE id`.
- Wer sich einloggt, übernimmt auch den Besitz (Feld *Spieler*). Logout lässt
  den Besitz stehen.

## 0.6.0 — 2026-08-18
Login je Charakter

- `Login` / `Logout` je Zeile, zeigt wer gerade draufsitzt (mit Uhrzeit);
  Übernahme eines fremden Logins nur nach Rückfrage.
- g-status-Channels ausgeblendet (`CH.SHOW_CHANNELS`), weil der gespielte
  Server dort nicht gelistet ist.

## 0.5.0 — 2026-08-18
Eigene Spawns

- Beschriftete Spawns in der Seitenspalte, gemeinsam in der Datenbank.
  Eingabe versteht `39:30`, `min39:30`, `:39`, `39` und `39:30 /30m`.
- Spawn-Rechnung nicht mehr fest stündlich, sondern beliebige Periode.
- Countdown **und** Uhrzeit überall.

## 0.4.0 — 2026-08-18
Anmeldung („Regi")

- Zweiter Knopf bei Runs mit Anmeldung (Meley), speichert den Zeitpunkt.
- Der Start des Cooldowns verbraucht die Anmeldung.
- `timers` trägt jetzt Anmeldung und Cooldown in einer Zeile.

## 0.3.0 — 2026-08-18
Bedienung

- Alle Knöpfe heißen `starten` (vorher `fertig` / `Start`).
- Tabellenkopf klebte über der ersten Zeile — `overflow` am Wrapper entfernt.
- Channels als schmale Seitenspalte statt breiter Leiste.
- Server-Auswahl entfernt, Server steht als `CH.SERVER` im Code.

## 0.2.0 — 2026-08-18
Erste lauffähige Fassung

- Charaktere, Cooldowns, Timer-Dialog, Einstellungen, Ton + Benachrichtigung.
- Supabase mit Realtime als gemeinsame Datenbank, lokaler Rückfallmodus.
- g-status-Abgleich als stündlicher GitHub-Actions-Cron.
