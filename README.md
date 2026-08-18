# Metin2 Run-Tracker

Gemeinsames Dashboard für Run-Cooldowns (Hydra, Nemere, Jotun, Meley, 6/7, Bio)
und die Channel-Spawns des DE-Clusters. Mehrere Leute sehen dieselben Timer in
Echtzeit — wer einen Run abschließt, startet den Cooldown für alle sichtbar.

Gleiche Bauart wie [`ctk-helper-jogoe`](../ctk-helper-jogoe) und
[`metin2-zodiac-pattern`](../metin2-zodiac-pattern): reines HTML + CSS +
Vanilla-JS, kein Build-Schritt.

**Bewusst keine ES-Module** — nur `<script src>`, damit `index.html` auch per
Doppelklick von der Platte läuft. Fällt ein Skript aus, erscheint ein roter
Balken statt einer stillen leeren Seite.

---

## Was es kann

- **Charaktere**, gruppiert nach Spieler. Cooldowns sind charaktergebunden
  (6/7 und Bio sind es im Spiel ohnehin).
- **Ein Klick = Cooldown läuft.** Der Knopf heißt überall *starten*; ob der
  Cooldown im Spiel ab dem Betreten oder ab dem Abschluss zählt, steht in der
  Spaltenüberschrift (`ab Start`) und ist pro Run einstellbar.
- **Countdowns rechnet jeder Browser selbst** aus `started_at` + `ends_at`.
  Übertragen wird nur, *wenn* jemand etwas ändert — deshalb braucht es kein
  Polling im Sekundentakt.
- **Anmeldung („Regi")** bei Runs, die eine haben — vorerst nur Meley,
  in den Einstellungen pro Run umschaltbar. Der Knopf *Regi gemacht* schreibt
  die Uhrzeit in die Zelle; ein Klick darauf setzt sie zurück. Mit dem Start
  des Cooldowns gilt die Anmeldung als verbraucht und wird geleert — sonst
  bliebe eine Uhrzeit stehen, die nichts mehr bedeutet.
- **Channel-Leiste**: je Channel Status, Countdown **und Uhrzeit** des nächsten
  stündlichen Spawns. Es gibt **keine Server-Auswahl** — gespielt wird
  auf einem Server, er steht als `CH.SERVER` in `channels.js` (aktuell
  `Tigerghost`). Der Cron holt trotzdem den ganzen DE-Cluster, ein Wechsel ist
  also diese eine Zeile.
- **Eigene Spawns** in derselben Seitenspalte: Beschriftung (z. B.
  *Metins Wald CH1*) plus Takt eintragen, fertig. Verstanden werden `39:30`,
  `min39:30`, `:39`, `39` und mit Periode `39:30 /30m` bzw. `39:30 alle 15m`
  (Vorgabe stündlich). Sie liegen in der Datenbank, gelten also für alle.
- **Ton + Browser-Benachrichtigung** beim Ablauf, mit einstellbarer
  Vorwarnzeit und eigenen Tondateien pro Run.
- **Ohne Zugangsdaten läuft alles lokal weiter** (localStorage) — dann sieht es
  nur niemand sonst.

## Zugang

Die Seite fragt nach **Name und Passwort** (dasselbe wie beim Zodiak-Helfer;
im Repo steht nur der Hash). Der Name hängt an den Charakteren, damit man
sieht, wessen Timer das sind.

Jeder darf alles ändern — auch fremde Timer. Das ist Absicht: man trägt oft
füreinander ein.

---

## Einrichtung

### 1. Datenbank (einmalig)

`sql/schema.sql` im SQL-Editor des Supabase-Projekts ausführen. Bei einer
**bereits angelegten** Datenbank zusätzlich `sql/2026-08-18_registration.sql`
(Anmeldung) und `sql/2026-08-18_spawns.sql` (eigene Spawns) — beide
wiederholbar. Das Skript ist
wiederholbar, ein zweiter Lauf schadet nicht. Es legt vier Tabellen an
(`chars`, `timers`, `run_types`, `channels`), setzt RLS auf „anon darf alles"
und schaltet Realtime ein.

### 2. App verbinden

`index.html` öffnen → *Einstellungen* → **Projekt-URL** und **Publishable Key**
(`sb_publishable_…`) einfügen → *Verbinden*. Beides liegt im localStorage.

> Die Zugangsdaten stehen **absichtlich nicht im Repo**: die Seite liegt
> öffentlich auf GitHub Pages, und der Key ist eine Schreibberechtigung. Wer
> ihn hat, kann alle Timer lesen und ändern. Also nur an die Mitspieler geben.

### 3. Channel-Daten

`.github/workflows/gstatus.yml` holt stündlich [g-status.com](https://www.g-status.com/en-gb/game/metin2)
und schreibt die Neustartzeiten in die `channels`-Tabelle. Dafür zwei
Repository-Secrets setzen (*Settings → Secrets and variables → Actions*):

| Secret | Wert |
|---|---|
| `SUPABASE_URL` | `https://<projekt>.supabase.co` |
| `SUPABASE_KEY` | derselbe `sb_publishable_…`-Key |

Warum ein Cron und nicht direkt aus dem Browser: **g-status schickt keinen
CORS-Header**, eine statische Seite kann die Daten also nicht selbst holen.
Stündlich reicht, weil sich die Werte nur bei einem Serverneustart ändern.

Zum Prüfen ohne Schreibzugriff:

```
node tools/fetch-gstatus.mjs --dry
```

---

## Wie die Spawn-Rechnung funktioniert

g-status meldet je Channel den letzten Neustart. Danach laufen die Spawns
stündlich in derselben Minute weiter — die **Minute:Sekunde des Neustarts** ist
also der Takt.

Zwei Eigenheiten, aus [`metin2-mob-alert`](../metin2-mob-alert) übernommen und
am 18.08.2026 am gesamten DE-Cluster nachgeprüft:

1. **CH1 meldet Unsinn.** Sein Zeitstempel hängt am Login-Server (Germania:
   CH1 `11:57:18` gegen CH3 `10:47:49`). CH1 übernimmt deshalb den Wert von
   **CH3** — die Anzeige sagt das dazu.
2. **Die Zeitzone von g-status ist unbekannt und egal.** Zonen-Offsets sind
   volle Stunden, die Minute bleibt also erhalten. Nur die absolute Uhrzeit
   darf man nicht als Ortszeit lesen — sie wird als *Serverzeit* geführt
   (`channels.last_restart` ist bewusst `text`, nicht `timestamptz`).

Beobachtet: der Cluster wird gemeinsam neu gestartet (Chimera und Germania
haben dieselben Minuten), aber einzelne Channels starten auch für sich neu
(Tigerghost CH2, Teutonia CH2) — deshalb rechnet jeder Channel mit seinem
eigenen Takt.

## Cooldown-Vorgaben

| Run | Dauer | läuft ab |
|---|---|---|
| Hydra | 20 min | Betreten |
| Nemere | 4 h | Abschluss |
| Jotun | 2 h | Abschluss |
| Meley | 3 h | Abschluss (mit Anmeldung) |
| 6/7 Bonus | 24 h | Abgabe |
| Bio | 24 h | Abgabe |

Alle Werte sind in den Einstellungen änderbar und gelten dann für alle; neue
Runs lassen sich dort ebenfalls anlegen.

## Test

```
node _smoke.cjs
```

Bootet das echte `index.html` in jsdom, legt einen Charakter an, startet und
ändert Timer, prüft Alarm-Auslösung, die Channel-Rechnung und das Gate.
jsdom wird aus dem Nachbar-Repo `metin2-zodiac-pattern` geliehen, damit dieses
Repo abhängigkeitsfrei bleibt.
