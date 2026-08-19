/* Was ist ein Run wert?
 *
 * Rechnet aus drei Zutaten:
 *   run_loot      was ein Run im Schnitt abwirft (von uns eingetragen)
 *   chest_values  Erwartungswert je Truhe   \  vom Push-Job aus metin-bazar-pro,
 *   item_prices   Marktpreis je Einzelitem  /  hier nur gelesen
 * und der Cooldown-Dauer aus run_types kommt Yang pro Stunde heraus — die
 * einzige Zahl, mit der sich zwei Runs ehrlich vergleichen lassen.
 *
 * WAEHRUNG: alle Preise sind "unified Yang" — 1 Won = 100.000.000 Yang, immer
 * pro Stueck. So sind Won- und Yang-Angebote ueberhaupt vergleichbar.
 *
 * DATENALTER: die Preise entstehen auf Dominiks PC. Laeuft der nicht, altern
 * sie. Deshalb rechnet hier nichts ohne `age()` — die Oberflaeche zeigt das
 * Alter immer mit an, sonst haelt man alte Zahlen fuer aktuelle.
 *
 * Bewusst kein ES-Modul (siehe util.js).
 */
(function () {
  'use strict';

  var P = window.PRICES = {};

  var WON = 100000000;

  /* ab 100 Mio in Won, darunter in Yang — dieselbe Regel wie in metin-bazar-pro */
  P.fmt = function (v) {
    v = Number(v) || 0;
    var neg = v < 0;
    var a = Math.abs(v);
    var s = a >= WON
      ? (a / WON).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' Won'
      : Math.round(a).toLocaleString('de-DE') + ' Yang';
    return (neg ? '−' : '') + s;
  };

  /* kurz fuer die Spaltenkoepfe: "1,73 Won" / "8,5 Mio" / "740k" */
  P.fmtShort = function (v) {
    v = Number(v) || 0;
    var neg = v < 0, a = Math.abs(v), s;
    if (a >= WON) s = (a / WON).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' Won';
    else if (a >= 1000000) s = (a / 1000000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mio';
    else if (a >= 1000) s = Math.round(a / 1000) + 'k';
    else s = String(Math.round(a));
    return (neg ? '−' : '') + s;
  };

  function chest(vnum) {
    return DB.data.chest_values.find(function (c) { return Number(c.vnum) === Number(vnum); }) || null;
  }
  function item(vnum) {
    return DB.data.item_prices.find(function (c) { return Number(c.vnum) === Number(vnum); }) || null;
  }

  /* Sekunden seit dem juengsten Preis-Zeitstempel; null = noch keine Preise. */
  P.age = function () {
    var newest = 0;
    DB.data.chest_values.concat(DB.data.item_prices).forEach(function (r) {
      var t = Date.parse(r.fetched_at || '');
      if (t && t > newest) newest = t;
    });
    if (!newest) return null;
    return Math.max(0, Math.round((Date.now() - newest) / 1000));
  };

  /* 'fresh' < 30 min · 'ok' < 2 h · 'stale' darueber. Der Push laeuft alle
     10 Minuten, alles darueber heisst: der PC lief nicht. */
  P.ageClass = function (sec) {
    if (sec === null) return 'none';
    if (sec < 1800) return 'fresh';
    if (sec < 7200) return 'ok';
    return 'stale';
  };

  /* Wert eines Runs. null, wenn fuer den Run keine Beute eingetragen ist. */
  P.valueFor = function (runKey) {
    var loot = DB.lootFor(runKey);
    if (!loot.length) return null;

    var rt = DB.data.run_types.find(function (r) { return r.key === runKey; });
    var gain = 0, cost = 0, missing = 0;
    var parts = [];

    loot.forEach(function (l) {
      var isItem = l.kind === 'item';
      var src = isItem ? item(l.vnum) : chest(l.vnum);
      var unit = src ? Number(isItem ? src.price : src.expected_value) : 0;
      if (!src || !unit) missing++;

      var qty = Number(l.qty) || 0;
      var value = unit * qty;
      if (l.is_cost) cost += value; else gain += value;

      parts.push({
        name: l.name || (src && src.name) || ('vnum ' + l.vnum),
        vnum: l.vnum,
        qty: qty,
        kind: l.kind,
        isCost: !!l.is_cost,
        unit: unit,
        value: value,
        note: l.note || '',
        known: !!(src && unit)
      });
    });

    var perRun = gain - cost;
    var seconds = rt && rt.seconds ? Number(rt.seconds) : 0;
    // Laufzeit = wie lange der Run tatsaechlich dauert. Wer genug Charaktere
    // hat, wartet nie auf den Cooldown — dann zaehlt die eigene Zeit, nicht
    // die Sperre. 0 = nicht eingetragen, dann gibt es die Zahl nicht.
    var runSec = rt && rt.run_seconds ? Number(rt.run_seconds) : 0;

    return {
      runKey: runKey,
      label: rt ? rt.label : runKey,
      color: rt ? rt.color : '#888',
      perRun: perRun,
      gain: gain,
      cost: cost,
      seconds: seconds,
      runSeconds: runSec,
      perHour: seconds > 0 ? perRun / (seconds / 3600) : 0,
      perHourActive: runSec > 0 ? perRun / (runSec / 3600) : null,
      parts: parts,
      missing: missing
    };
  };

  /* Alle Runs mit Beute, bester Stundenwert zuerst. Sortiert nach der
     Laufzeit-Rechnung, wo es sie gibt — die beantwortet "was mache ich
     jetzt in der naechsten Stunde", der Cooldown nur "was tickt". */
  P.ranking = function () {
    return DB.runTypes()
      .map(function (r) { return P.valueFor(r.key); })
      .filter(Boolean)
      .sort(function (a, b) {
        var av = a.perHourActive === null ? a.perHour : a.perHourActive;
        var bv = b.perHourActive === null ? b.perHour : b.perHourActive;
        return bv - av;
      });
  };
})();
