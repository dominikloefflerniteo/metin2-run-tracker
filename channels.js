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

  /* Sekunden bis zum naechsten Spawn dieses Takts. */
  CH.secondsToNext = function (tick, now) {
    if (!tick) return null;
    now = now || new Date();
    var offsetInHour = tick.minute * 60 + tick.second;      // 0..3599
    var nowInHour = now.getMinutes() * 60 + now.getSeconds();
    var d = offsetInHour - nowInHour;
    if (d <= 0) d += CH.PERIOD_SEC;
    return d;
  };

  /* Zeitpunkt des naechsten Spawns als lokale Uhrzeit. */
  CH.nextAt = function (tick, now) {
    var sec = CH.secondsToNext(tick, now);
    if (sec === null) return null;
    return new Date((now || new Date()).getTime() + sec * 1000);
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
