/* Kleine Helfer — bewusst global (kein ES-Modul, damit index.html auch per
   Doppelklick von der Platte laeuft). */
(function () {
  'use strict';

  var U = window.U = {};

  U.$ = function (id) { return document.getElementById(id); };

  U.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  U.uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  };

  /* "2h", "20m", "3h30m", "7d", "90" (= Sekunden? nein: Minuten waeren zu
     raten) -> Sekunden. Eine nackte Zahl gilt als Minuten, das ist beim
     Tippen die haeufigste Absicht. Null bei Unsinn. */
  U.parseDur = function (s) {
    s = String(s || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return 0;
    if (/^\d+$/.test(s)) return parseInt(s, 10) * 60;
    var re = /(\d+(?:[.,]\d+)?)\s*(d|t|h|std|m|min|s|sek)/g, m, total = 0, hit = false;
    while ((m = re.exec(s))) {
      hit = true;
      var v = parseFloat(m[1].replace(',', '.'));
      var u = m[2];
      if (u === 'd' || u === 't') total += v * 86400;
      else if (u === 'h' || u === 'std') total += v * 3600;
      else if (u === 'm' || u === 'min') total += v * 60;
      else total += v;
    }
    return hit ? Math.round(total) : 0;
  };

  /* Sekunden -> "7d", "4h", "20m", "3h30m" (kurz, fuer Einstellungen). */
  U.fmtDur = function (sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var d = Math.floor(sec / 86400); sec -= d * 86400;
    var h = Math.floor(sec / 3600);  sec -= h * 3600;
    var m = Math.floor(sec / 60);    sec -= m * 60;
    var out = '';
    if (d) out += d + 'd';
    if (h) out += h + 'h';
    if (m) out += m + 'm';
    if (sec && !d && !h) out += sec + 's';
    return out || '0m';
  };

  /* Sekunden -> Countdown "1:04:22" / "12:07" / "0:09" */
  U.fmtClock = function (sec) {
    sec = Math.max(0, Math.ceil(sec || 0));
    var d = Math.floor(sec / 86400);
    var h = Math.floor(sec % 86400 / 3600);
    var m = Math.floor(sec % 3600 / 60);
    var s = sec % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    if (d) return d + 'd ' + h + ':' + p(m);
    if (h) return h + ':' + p(m) + ':' + p(s);
    return m + ':' + p(s);
  };

  U.fmtTime = function (date) {
    if (!date) return '—';
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d)) return '—';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    var t = p(d.getHours()) + ':' + p(d.getMinutes());
    return sameDay ? t : (p(d.getDate()) + '.' + p(d.getMonth() + 1) + '. ' + t);
  };

  U.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    }
  };

  /* Sichtbarer Fehlerbalken statt einer stillen leeren Seite. */
  U.fail = function (msg) {
    var box = U.$('bootError');
    if (!box) { alert(msg); return; }
    box.hidden = false;
    box.textContent = msg;
  };
})();
