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

  /* "3,5 Won" / "20 Mio" / "350000000" / "740k" -> Yang. 0 bei Unsinn.
     Gegenstueck zu fmt/fmtShort, damit man Pauschalen so eintippen kann, wie
     sie angezeigt werden. */
  P.parseYang = function (s) {
    s = String(s || '').trim().toLowerCase().replace(/\./g, '').replace(',', '.');
    var m = /^([0-9]*\.?[0-9]+)\s*(won|mio|mrd|k)?$/.exec(s);
    if (!m) return 0;
    var n = parseFloat(m[1]);
    if (!isFinite(n)) return 0;
    var u = m[2];
    if (u === 'won') n *= WON;
    else if (u === 'mrd') n *= 1000000000;
    else if (u === 'mio') n *= 1000000;
    else if (u === 'k') n *= 1000;
    return Math.round(n);
  };

  function chest(vnum) {
    return DB.data.chest_values.find(function (c) { return Number(c.vnum) === Number(vnum); }) || null;
  }
  function item(vnum) {
    return DB.data.item_prices.find(function (c) { return Number(c.vnum) === Number(vnum); }) || null;
  }

  /* Von Hand gesetzter Preis, falls vorhanden. Dafuer gibt es zwei Gruende:
     Untradeables haben nie einen Marktpreis (stehen also auf 0), und manchmal
     weiss man es einfach besser als der Markt-Schnitt. Gilt fuer alle. */
  function overrideRow(vnum) {
    return (DB.data.price_overrides || []).find(function (r) {
      return Number(r.vnum) === Number(vnum);
    }) || null;
  }

  P.override = function (vnum) {
    var o = overrideRow(vnum);
    return o && Number(o.price) > 0 ? Number(o.price) : null;
  };

  /* "zählt nicht" — der Drop faellt komplett aus der Rechnung. Gedacht fuer
     alles, was man ohnehin liegen laesst; nicht dasselbe wie "kein Preis
     bekannt", auch wenn beides mit 0 endet. */
  P.ignored = function (vnum) {
    var o = overrideRow(vnum);
    return !!(o && o.ignored);
  };

  /* Erwartungswert einer Truhe, aus ihren Drops NACHGERECHNET — damit ein von
     Hand gesetzter Preis sofort wirkt und nicht erst beim naechsten Push.
     Ohne Drop-Liste bleibt der gepushte Wert stehen. */
  P.chestEV = function (c) {
    if (!c) return 0;
    if (!Array.isArray(c.drops) || !c.drops.length) return Number(c.expected_value) || 0;
    var openings = Number(c.openings) || 1;
    var sum = 0;
    c.drops.forEach(function (d) {
      if (P.ignored(d.vnum)) return;
      var unit = P.override(d.vnum);
      if (unit === null) unit = Number(d.unit) || 0;
      sum += unit * (Number(d.qty) || 0) * ((Number(d.rate) || 0) / 100) * openings;
    });
    return sum;
  };

  /* Dieselbe Aufschluesselung, aber mit Ueberschreibungen und sortiert.
     Dasselbe Item steht in einer Droptabelle oft MEHRFACH (Titandioxid liegt
     zweimal mit 0,89 % in der Nemere-Truhe). Fuer die Rechnung ist das egal —
     2 × 0,89 % ist dasselbe wie 1 × 1,78 % — aber in der Liste sieht es nach
     einem Fehler aus. Deshalb werden gleiche Zeilen hier zusammengefasst und
     ihre Raten addiert. */
  P.chestBreakdown = function (c) {
    if (!c || !Array.isArray(c.drops)) return [];
    var openings = Number(c.openings) || 1;
    return merge(c.drops).map(function (d) {
      var ov = P.override(d.vnum);
      var unit = ov === null ? (Number(d.unit) || 0) : ov;
      var skip = P.ignored(d.vnum);
      return {
        vnum: d.vnum,
        name: d.name,
        qty: Number(d.qty) || 0,
        rate: Number(d.rate) || 0,
        rows: d.rows || 1,          // wie viele Eintraege zusammengefasst wurden
        unit: unit,
        manual: ov !== null,
        ignored: skip,
        untradeable: !!d.untradeable,
        ev: skip ? 0 : unit * (Number(d.qty) || 0) * ((Number(d.rate) || 0) / 100) * openings
      };
    }).sort(function (a, b) { return b.ev - a.ev; });
  };

  /* Gleiches Item UND gleiche Stueckzahl -> eine Zeile, Raten addiert.
     Unterschiedliche Mengen bleiben getrennt (3× Gegenstand verstaerken ist
     nicht dasselbe wie 1×). */
  function merge(drops) {
    var out = [], byKey = {};
    drops.forEach(function (d) {
      var key = d.vnum + ':' + d.qty;
      if (byKey[key]) {
        byKey[key].rate += Number(d.rate) || 0;
        byKey[key].rows++;
        return;
      }
      var copy = { vnum: d.vnum, name: d.name, qty: d.qty, rate: Number(d.rate) || 0,
                   unit: d.unit, untradeable: d.untradeable, rows: 1 };
      byKey[key] = copy;
      out.push(copy);
    });
    return out;
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
      // 'fixed' = Pauschale: die Menge IST der Wert in Yang. Fuer Runs, deren
      // Ertrag nicht aus einer Truhe kommt (Meley) und den man aus Erfahrung
      // kennt — Marktpreise gibt es dafuer nicht.
      var isFixed = l.kind === 'fixed';
      var isItem = l.kind === 'item';
      var src = isFixed ? null : (isItem ? item(l.vnum) : chest(l.vnum));
      var unit;
      if (isFixed) unit = Number(l.qty) || 0;
      else if (isItem) {
        var ov = P.override(l.vnum);
        unit = ov !== null ? ov : (src ? Number(src.price) : 0);
      } else unit = P.chestEV(src);
      if (!isFixed && (!src || !unit)) missing++;

      var qty = isFixed ? 1 : (Number(l.qty) || 0);
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
        fixed: isFixed,
        known: isFixed ? unit > 0 : !!(src && unit)
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
