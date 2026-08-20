# Änderungen

Neuestes zuerst. Die oberste Nummer muss mit `version.js` übereinstimmen —
der Smoketest prüft das.

## 0.9.0 — 2026-08-20
Reiter Bazar: was ein Run wert ist, und ob sich Alchemie lohnt

- Neuer Reiter **Bazar** neben **Runs**. Alles Preisliche liegt dort:
  **Was lohnt sich** (Runs nach Stundenwert), **Truhen** (Marktpreis gegen
  Erwartungswert mit Fazit *öffnen* / *verkaufen*) und **Alchemie**.
- **Alchemie**: alle sechs Drachensteine über alle Stufen mit Marktpreis,
  dazu je Stufe was der Aufstieg kostet und was er bringt. Grundlage sind die
  Erfolgsraten aus dem Spiel. Ein Versuch verbraucht **zwei** Steine, im
  Fehlschlag kommt einer zurück — erwarteter Verbrauch je Stufe ist also
  `2 + (1−p)/p`: bei 50 % **drei** Steine, bei den Mythisch-Unterstufen (70 %)
  **2,43**. Oben steht das beste Geschäft über alle Steine.
- **Wert pro Run und Yang/h** im Spaltenkopf der Runs-Tabelle. Der Tooltip
  schlüsselt auf, welche Truhe wie viel beiträgt; das `?` öffnet die
  Aufschlüsselung.
- **Laufzeit je Run** in den Einstellungen neben dem Cooldown. Wer genug
  Charaktere hat, wartet nie auf einen Cooldown — dann ist die eigene Zeit der
  Engpass, und genau darauf rechnet die Seite dann Yang/h. Ohne Eintrag bleibt
  es beim Cooldown.
- **Run-Beute** in den Einstellungen: welche Truhe ein Run im Schnitt abwirft
  (Menge darf krumm sein), Kosten-Haken für Schlüssel und Eintritt.
- Preise kommen aus Supabase (`chest_values`, `item_prices`), befüllt vom
  Push-Job in metin-bazar-pro auf Dominiks PC. **Das Alter der Preise steht
  immer dabei** — grün unter 30 min, gelb unter 2 h, danach rot.
- **Aufschlüsselung** hinter dem `?` im Spaltenkopf (oder Klick in der
  Seitenspalte): Truhen pro Run, und je Truhe **jeder** mögliche Drop mit Rate,
  Stückpreis und Beitrag — dazu **Marktpreis gegen Erwartungswert** samt Fazit
  *öffnen* oder *verkaufen*.
- Steht dasselbe Item **mehrfach** in einer Droptabelle (Titandioxid liegt
  zweimal mit 0,89 % in der Nemere-Truhe), wird es in der Anzeige zu einer
  Zeile mit addierter Rate zusammengefasst und mit `*` markiert. An der
  Rechnung ändert das nichts — 2 × 0,89 % ist dasselbe wie 1 × 1,78 %.
- Spalte **zählt**: Haken raus, und der Drop fällt ganz aus der Rechnung —
  für alles, was man ohnehin liegen lässt. Ein gesetzter Preis bleibt dabei
  erhalten, falls man es sich anders überlegt.
- **Preise von Hand setzen**, direkt in der Aufschlüsselung. Nötig für alles,
  was nicht handelbar ist (Segenskugel, Blutstein) und deshalb nie einen
  Marktpreis hat. Gilt für alle, wirkt sofort — der Erwartungswert wird im
  Browser aus den Drops nachgerechnet, nicht erst beim nächsten Push.
- Neu: `sql/2026-08-19_prices.sql` (fünf Tabellen + `run_types.run_seconds`).

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
