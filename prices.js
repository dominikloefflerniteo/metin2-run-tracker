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

  /* ========================================================== Watchlist
   *
   * Der Abgleich passiert NICHT hier: die Seite sieht den Markt nie, sie kennt
   * nur die Treffer, die metin-bazar-pro nach jedem Poll in `watch_hits`
   * schreibt. Hier steht nur, was die Oberflaeche daraus macht.
   */

  /* Item-Suche fuer das Anlegen eines Eintrags. Gesucht wird ueber den
     GESAMTEN Katalog (items.js, 12.273 Items), nicht nur ueber das, was
     gerade angeboten wird — sonst koennte man genau das nicht ueberwachen,
     was selten kommt. Ganz oben stehen die Gruppen ("Titanenschild +0–9"),
     die alle Schmiedestufen auf einmal abdecken.

     Was gerade am Markt liegt, steht als Hinweis dran (aus `market_items`). */
  P.searchItems = function (q, limit) {
    var hits = ITEMS.search(q, limit || 30);
    var market = DB.data.market_items || [];
    return hits.map(function (h) {
      var n = 0, cheapest = 0;
      h.vnums.forEach(function (v) {
        var m = market.find(function (x) { return Number(x.vnum) === Number(v); });
        if (!m) return;
        n += Number(m.listings) || 0;
        var c = Number(m.cheapest) || 0;
        if (c > 0 && (cheapest === 0 || c < cheapest)) cheapest = c;
      });
      h.listings = n;
      h.cheapest = cheapest;
      return h;
    });
  };

  /* Treffer, neueste zuerst. */
  P.hits = function (onlyUnseen) {
    return (DB.data.watch_hits || [])
      .filter(function (h) { return !onlyUnseen || !h.seen; })
      .sort(function (a, b) { return Date.parse(b.found_at) - Date.parse(a.found_at); });
  };

  P.unseenCount = function () { return P.hits(true).length; };

  /* Boni eines Treffers als lesbare Zeile. */
  P.attrText = function (attrs) {
    if (!attrs || !attrs.length) return 'ohne Boni';
    return attrs.map(function (a) { return STATS.format(a[0], a[1]); }).join(' · ');
  };

  /* ====================================================== Drachensteine
   *
   * Ein Aufstieg verbraucht ZWEI Steine, im Fehlschlag kommt EINER zurueck.
   * Erwarteter Verbrauch je gewonnener Stufe:
   *
   *     2 + (1 - p) / p        p = Erfolgswahrscheinlichkeit
   *
   *   p = 0,50  ->  2 + 1,0000  =  3,00 Steine
   *   p = 0,70  ->  2 + 0,4286  =  2,43 Steine
   *
   * NICHT 1/p — das zaehlt nur die Versuche und unterschlaegt, dass jeder
   * Versuch zwei Steine frisst. (Genau der Fehler stand bis 2026-08-20 in
   * metin-bazar-pro und hat die Mythisch-Aufstiege fast doppelt so
   * lohnend aussehen lassen, wie sie sind.)
   *
   * Die Raten gehoeren zum Spiel, nicht zum Server — sie stehen hier fest.
   */
  P.RATE_BASE = 0.5;                // Roher bis Legendaer -> Mythisch
  P.RATE_MYTHISCH = 0.7;            // zwischen den Mythisch-Unterstufen
  P.factorFor = function (p) { return 2 + (1 - p) / p; };
  P.UPGRADE_FACTOR = P.factorFor(P.RATE_BASE);       // 3,00
  P.MYTHISCH_FACTOR = P.factorFor(P.RATE_MYTHISCH);  // 2,4286

  /* Alle Steine, jeder mit seinen Stufen in Aufstiegsreihenfolge. */
  P.stones = function () {
    var by = {};
    (DB.data.alchemy_prices || []).forEach(function (r) {
      if (!by[r.stone]) by[r.stone] = { stone: r.stone, name: r.stone_name, rows: [] };
      by[r.stone].rows.push(r);
    });
    return Object.keys(by).map(function (k) {
      var s = by[k];
      s.rows.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
      s.steps = P.upgradeSteps(s.rows);
      return s;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  };

  /* Je Stufenpaar: was kostet der Aufstieg, was bringt er. */
  P.upgradeSteps = function (rows) {
    var out = [];
    for (var i = 0; i < rows.length - 1; i++) {
      var from = rows[i], to = rows[i + 1];
      var fromPrice = P.override(from.vnum) !== null ? P.override(from.vnum) : Number(from.price) || 0;
      var toPrice = P.override(to.vnum) !== null ? P.override(to.vnum) : Number(to.price) || 0;
      // Innerhalb der Mythisch-Unterstufen gilt die bessere Rate.
      var factor = (from.tier === 'mythisch' && to.tier === 'mythisch')
        ? P.MYTHISCH_FACTOR : P.UPGRADE_FACTOR;
      var cost = fromPrice * factor;
      out.push({
        from: from, to: to,
        fromPrice: fromPrice, toPrice: toPrice,
        factor: factor,
        cost: cost,
        profit: toPrice - cost,
        percent: cost > 0 ? ((toPrice - cost) / cost) * 100 : 0,
        known: fromPrice > 0 && toPrice > 0
      });
    }
    return out;
  };

  /* Der lohnendste Aufstieg ueber alle Steine — die eine Zahl, die man wissen will. */
  P.bestUpgrade = function () {
    var best = null;
    P.stones().forEach(function (s) {
      s.steps.forEach(function (st) {
        if (!st.known || st.profit <= 0) return;
        if (!best || st.percent > best.percent) {
          best = { stone: s.name, step: st, percent: st.percent };
        }
      });
    });
    return best;
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
