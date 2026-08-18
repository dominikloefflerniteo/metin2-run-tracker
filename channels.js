/* Channel-Spawns.
 *
 * Woher die Zahlen kommen: g-status.com meldet je Channel den letzten
 * Neustart. Nach jedem Neustart laufen die Spawns stuendlich in derselben
 * Minute weiter — die Minute:Sekunde des Neustarts ist also der Taktgeber.
 *
 * Zwei Eigenheiten, beide aus metin2-mob-alert uebernommen und hier am
 * gesamten DE-Cluster nachgeprueft (18.08.2026):
 *
 *  1. CH1 meldet Unsinn. Sein Zeitstempel haengt am Login-Server (Germania:
 *     CH1 11:57:18 vs. CH3 10:47:49) — CH1 uebernimmt deshalb CH3s Wert.
 *  2. Die Zeitzone von g-status ist unbekannt und egal: Zonen-Offsets sind
 *     volle Stunden, die Minute bleibt also erhalten. Nur die absolute Uhrzeit
 *     darf man nicht als Ortszeit lesen — sie wird als "Serverzeit" angezeigt.
 */
(function () {
  'use strict';

  var CH = window.CH = {};

  /* Gespielt wird nur auf einem Server — deshalb gibt es keine Auswahl mehr.
     Der Cron holt trotzdem den ganzen DE-Cluster, ein Wechsel waere also nur
     diese eine Zeile. */
  CH.SERVER = 'Tigerghost';

  /* Der Server, um den es gerade geht, steht NICHT auf g-status — die
     Channel-Anzeige waere also nur falsche Sicherheit. Code und Cron bleiben,
     die Anzeige ist ausgeblendet: auf true stellen, sobald der Server dort
     auftaucht (oder CH.SERVER passt). */
  CH.SHOW_CHANNELS = false;

  CH.SERVERS = [
    '[RUBY] Chimera',
    'Germania',
    'Teutonia',
    'Europe',
    'Iberia',
    'Tigerghost'
  ];

  CH.LIST = ['CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6'];

  /* Channel -> borgt sich den Zeitstempel von */
  CH.ANCHOR_OVERRIDE = { CH1: 'CH3' };

  CH.PERIOD_SEC = 3600;

  var TS_RE = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

  /* "2026-08-11 10:47:49" -> {minute, second} oder null */
  CH.tick = function (raw) {
    var m = TS_RE.exec(String(raw || ''));
    if (!m) return null;
    return { minute: parseInt(m[5], 10), second: parseInt(m[6], 10) };
  };

  /* Sekunden bis zum naechsten Spawn dieses Takts.
     periodSec erlaubt auch andere Abstaende als stuendlich (eigene Spawns);
     der Takt zaehlt dann ab dem Beginn der laufenden Stunde. */
  CH.secondsToNext = function (tick, now, periodSec) {
    if (!tick) return null;
    now = now || new Date();
    var period = (periodSec || CH.PERIOD_SEC) * 1000;

    var hourStart = new Date(now.getTime());
    hourStart.setMinutes(0, 0, 0);
    var anchor = hourStart.getTime() + (tick.minute * 60 + tick.second) * 1000;

    var d = (anchor - now.getTime()) % period;
    if (d <= 0) d += period;          // JS-Modulo kann negativ werden
    return d / 1000;
  };

  /* Zeitpunkt des naechsten Spawns als lokale Uhrzeit. */
  CH.nextAt = function (tick, now, periodSec) {
    var sec = CH.secondsToNext(tick, now, periodSec);
    if (sec === null) return null;
    return new Date((now || new Date()).getTime() + sec * 1000);
  };

  /**
   * Eingabe fuer eigene Spawns lesen. Erlaubt ist, was man im Eifer tippt:
   *   "39:30"  "min39:30"  ":39"  "39"  "39:30 /30m"  "39:30 alle 30m"
   * -> { minute, second, period_sec } oder null.
   */
  CH.parseSpawnTime = function (input) {
    var s = String(input || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;

    var period = CH.PERIOD_SEC;
    var per = s.match(/(?:\/|alle)(.+)$/);
    if (per) {
      var p = (window.U ? U.parseDur(per[1]) : 0);
      if (!p) return null;
      period = p;
      s = s.slice(0, per.index);
    }

    s = s.replace(/^(min|minute|:)/, '');
    var m = s.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return null;

    var minute = parseInt(m[1], 10);
    var second = m[2] ? parseInt(m[2], 10) : 0;
    if (minute > 59 || second > 59) return null;
    return { minute: minute, second: second, period_sec: period };
  };

  /**
   * Aufbereitete Zeilen fuer einen Server.
   * rows = Inhalt der channels-Tabelle (alle Server).
   */
  CH.forServer = function (rows, server, now) {
    now = now || new Date();
    var byCh = {};
    (rows || []).forEach(function (r) {
      if (r.server === server) byCh[r.channel] = r;
    });

    return CH.LIST.map(function (ch) {
      var own = byCh[ch] || null;
      var srcCh = CH.ANCHOR_OVERRIDE[ch] || ch;
      var src = byCh[srcCh] || null;
      var tick = src ? CH.tick(src.last_restart) : null;

      return {
        channel: ch,
        status: own ? own.status : 'unknown',
        borrowedFrom: srcCh === ch ? null : srcCh,
        lastRestart: src ? src.last_restart : null,   // Serverzeit, als Text
        tick: tick,
        secondsToNext: CH.secondsToNext(tick, now),
        nextAt: CH.nextAt(tick, now),
        fetchedAt: own ? own.fetchedAt || own.fetched_at : (src ? src.fetched_at : null)
      };
    });
  };

  /* Wie alt sind die Daten? (Der Cron laeuft alle 10 Minuten.) */
  CH.age = function (rows, server) {
    var newest = 0;
    (rows || []).forEach(function (r) {
      if (server && r.server !== server) return;
      var t = Date.parse(r.fetched_at || '');
      if (t && t > newest) newest = t;
    });
    return newest ? (Date.now() - newest) / 1000 : null;
  };
})();
