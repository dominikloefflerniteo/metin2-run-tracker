/**
 * Erzeugt items.js aus metin2shoptracker/configs/item_names.json.
 *
 *   node tools/make-items.mjs
 *
 * Warum als Datei und nicht ueber Supabase: das sind 12.273 Items aus dem
 * Client — Spieldaten, die sich nur mit einem Patch aendern. Ueber die
 * Datenbank wuerden sie bei jedem Nachziehen (alle 30 s) erneut uebertragen.
 *
 * Gespeichert wird kompakt: Items mit Schmiedestufen (+0..+9) liegen im Spiel
 * auf FORTLAUFENDEN vnums, deshalb reicht [Basisname, erste vnum, Stufen].
 * Alles andere als [Name, vnum].
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', '..', 'metin2shoptracker', 'configs', 'item_names.json');
const names = JSON.parse(fs.readFileSync(src, 'utf8'));

const baseOf = (s) => String(s).replace(/\s*\+\d+$/, '').trim();
const levelOf = (s) => {
  const m = /\+(\d+)$/.exec(String(s).trim());
  return m ? Number(m[1]) : null;
};

const byBase = new Map();
for (const [vnumStr, name] of Object.entries(names)) {
  const vnum = Number(vnumStr);
  if (!Number.isFinite(vnum) || !name) continue;
  const b = baseOf(name);
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push({ vnum, name, level: levelOf(name) });
}

const groups = [];   // [base, firstVnum, levels, spaceBeforePlus]
const odd = [];      // [base, [vnum, ...], spaceBeforePlus]  (nicht fortlaufend)
const singles = [];  // [name, vnum]

for (const [base, rows] of byBase) {
  const levelled = rows.filter((r) => r.level !== null).sort((a, b) => a.level - b.level);
  const plain = rows.filter((r) => r.level === null);

  if (levelled.length > 1) {
    // Schreibweise merken: "Euphorieschuhe +3" hat ein Leerzeichen, "Titanenschild+2" nicht.
    const sp = / \+\d+$/.test(levelled[0].name) ? 1 : 0;
    const consecutive = levelled.every((r, i) =>
      r.level === levelled[0].level + i && r.vnum === levelled[0].vnum + i);
    if (consecutive && levelled[0].level === 0) {
      groups.push([base, levelled[0].vnum, levelled.length, sp]);
    } else {
      odd.push([base, levelled.map((r) => [r.level, r.vnum]), sp]);
    }
  } else {
    for (const r of levelled) singles.push([r.name, r.vnum]);
  }
  for (const r of plain) singles.push([r.name, r.vnum]);
}

const out = `/* Item-Katalog — ERZEUGT von tools/make-items.mjs, nicht von Hand aendern.
   Quelle: metin2shoptracker/configs/item_names.json (${Object.keys(names).length} Items aus dem Client).

   Items mit Schmiedestufen liegen auf fortlaufenden vnums, deshalb steht hier
   nur [Basisname, vnum von +0, Anzahl Stufen, Leerzeichen vor dem +]. Ein paar
   Reihen sind unregelmaessig, die stehen einzeln in ODD. */
(function () {
  'use strict';
  var GROUPS = ${JSON.stringify(groups)};
  var ODD = ${JSON.stringify(odd)};
  var SINGLES = ${JSON.stringify(singles)};

  var I = window.ITEMS = {};

  function nameOf(base, level, sp) { return base + (sp ? ' +' : '+') + level; }

  /* Alle Eintraege, die zu einem Suchwort passen. Gruppen ("alle Stufen")
     zuerst — sonst muesste man sich durch zehn Schmiedestufen scrollen, um
     zu merken, dass man eigentlich alle meint. */
  I.search = function (q, limit) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) return [];
    limit = limit || 30;

    var groupHits = [], itemHits = [];

    GROUPS.forEach(function (g) {
      var base = g[0], first = g[1], n = g[2], sp = g[3];
      if (base.toLowerCase().indexOf(q) === -1) return;
      var vnums = [];
      for (var i = 0; i < n; i++) vnums.push(first + i);
      groupHits.push({
        group: true,
        name: base + ' +0–' + (n - 1) + '  (alle Stufen)',
        base: base,
        vnums: vnums
      });
      for (var j = 0; j < n; j++) {
        itemHits.push({ group: false, name: nameOf(base, j, sp), vnums: [first + j] });
      }
    });

    ODD.forEach(function (o) {
      var base = o[0], rows = o[1], sp = o[2];
      if (base.toLowerCase().indexOf(q) === -1) return;
      groupHits.push({
        group: true,
        name: base + ' +' + rows[0][0] + '–' + rows[rows.length - 1][0] + '  (alle Stufen)',
        base: base,
        vnums: rows.map(function (r) { return r[1]; })
      });
      rows.forEach(function (r) {
        itemHits.push({ group: false, name: nameOf(base, r[0], sp), vnums: [r[1]] });
      });
    });

    SINGLES.forEach(function (s) {
      if (String(s[0]).toLowerCase().indexOf(q) === -1) return;
      itemHits.push({ group: false, name: s[0], vnums: [s[1]] });
    });

    function rank(a, b) {
      var an = a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      var bn = b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      return an - bn || a.name.localeCompare(b.name, 'de');
    }
    groupHits.sort(rank);
    itemHits.sort(rank);

    return groupHits.concat(itemHits).slice(0, limit);
  };

  I.count = ${Object.keys(names).length};
})();
`;

fs.writeFileSync(path.join(here, '..', 'items.js'), out);
console.log('items.js:', groups.length, 'Reihen,', odd.length, 'unregelmaessige,', singles.length, 'Einzelitems');
