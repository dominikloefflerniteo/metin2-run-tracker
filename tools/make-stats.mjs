/**
 * Erzeugt stats.js aus metin2shoptracker/configs/stat_map.json.
 *
 *   node tools/make-stats.mjs
 *
 * Das ist Spieldaten, keine Marktdaten — sie aendern sich nur mit einem
 * Client-Patch. Deshalb liegen sie als Datei im Repo und werden nicht ueber
 * Supabase geschoben.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', '..', 'metin2shoptracker', 'configs', 'stat_map.json');
const map = JSON.parse(fs.readFileSync(src, 'utf8'));

// Die Boni, nach denen man wirklich sucht — sie stehen im Auswahlfeld oben.
const TOP = [1, 7, 8, 9, 15, 16, 17, 18, 19, 20, 21, 22, 27, 29, 53, 54, 55, 56,
             59, 60, 61, 62, 63, 64, 65, 71, 72, 73, 74, 85, 90, 91, 94, 105, 115];

const rows = Object.entries(map)
  .map(([id, tpl]) => ({ id: Number(id), tpl: String(tpl) }))
  .filter((r) => Number.isFinite(r.id) && r.tpl)
  .sort((a, b) => {
    const ta = TOP.indexOf(a.id), tb = TOP.indexOf(b.id);
    if (ta !== -1 || tb !== -1) {
      if (ta === -1) return 1;
      if (tb === -1) return -1;
      return ta - tb;
    }
    return a.tpl.localeCompare(b.tpl, 'de');
  });

const out = `/* Bonusliste — ERZEUGT von tools/make-stats.mjs, nicht von Hand aendern.
   Quelle: metin2shoptracker/configs/stat_map.json (Spieldaten aus dem Client).
   STATS.top = die Boni, nach denen man ueblicherweise sucht, in dieser
   Reihenfolge; danach alles Uebrige alphabetisch. */
(function () {
  'use strict';
  var LIST = ${JSON.stringify(rows.map((r) => [r.id, r.tpl]))};
  var TOP = ${JSON.stringify(TOP)};

  var S = window.STATS = {
    list: LIST.map(function (r) { return { id: r[0], tpl: r[1], top: TOP.indexOf(r[0]) !== -1 }; })
  };

  var byId = {};
  S.list.forEach(function (s) { byId[s.id] = s; });

  /* "Angriffswert +%d" + 30 -> "Angriffswert +30" */
  S.format = function (id, value) {
    var s = byId[id];
    if (!s) return 'Stat ' + id + ': ' + value;
    return s.tpl.replace(/%d%%/g, value + '%')
                .replace(/%0\.1f%%/g, value + '%')
                .replace(/%d/g, String(value));
  };

  /* Name ohne Wert, fuer das Auswahlfeld: "Angriffswert" */
  S.label = function (id) {
    var s = byId[id];
    if (!s) return 'Stat ' + id;
    return s.tpl.replace(/\s*[+-]?%d%%/g, '').replace(/\s*[+-]?%0\.1f%%/g, '')
                .replace(/\s*[+-]?%d/g, '').trim() || s.tpl;
  };
})();
`;

fs.writeFileSync(path.join(here, '..', 'stats.js'), out);
console.log('stats.js geschrieben:', rows.length, 'Boni');
