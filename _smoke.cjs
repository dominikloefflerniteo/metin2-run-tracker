/* Headless-Smoketest: laedt index.html mit den echten Skripten, legt einen
   Charakter an, startet Timer, prueft Countdown, Alarme und Channel-Rechnung.
   Laeuft ohne Supabase — DB faellt dann auf localStorage zurueck.

   Start:  node _smoke.cjs
   (jsdom wird aus dem Nachbar-Repo metin2-zodiac-pattern geliehen, falls hier
   kein node_modules liegt — dieses Repo hat bewusst keine Abhaengigkeiten.) */

const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* weiter unten */ }
  const sibling = path.join(__dirname, '..', 'metin2-zodiac-pattern', 'node_modules', 'jsdom');
  try { return require(sibling); } catch (e) {
    console.error('jsdom fehlt. Entweder "npm i -D jsdom" hier, oder das Repo ' +
                  'metin2-zodiac-pattern (mit node_modules) daneben legen.');
    process.exit(2);
  }
}
const { JSDOM } = loadJsdom();

let fails = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ok  ' : '  FEHLER  ') + msg);
  if (!cond) fails++;
};

async function main() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  const doc = window.document;

  // Gate vorab entsperren; das Gate selbst wird am Ende separat geprueft.
  window.localStorage.setItem('m2rt.gate.v1', JSON.stringify({ ok: true, user: 'Jogoe' }));

  // Kein Netz im Test: kein window.supabase -> DB bleibt lokal.
  for (const f of ['gate.js', 'util.js', 'db.js', 'channels.js', 'alarm.js', 'app.js']) {
    window.eval(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  }

  const $ = (id) => doc.getElementById(id);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const { U, DB, CH, ALARM } = window;

  console.log('\n[start]');
  ok($('bootError').hidden === false, 'ohne Supabase-Bibliothek erscheint der Hinweisbalken');
  ok(!doc.body.classList.contains('locked'), 'Gate ist entsperrt');
  ok(DB.runTypes().length === 6, '6 Runs voreingestellt: ' + DB.runTypes().map(r => r.label).join(', '));
  ok(doc.querySelectorAll('#chGrid .chcard').length === 6, 'sechs Channel-Karten');
  ok(!$('emptyHint').hidden, 'Hinweis "noch kein Charakter" ist sichtbar');

  console.log('\n[Dauern lesen und schreiben]');
  ok(U.parseDur('2h') === 7200, '2h');
  ok(U.parseDur('20m') === 1200, '20m');
  ok(U.parseDur('3h30m') === 12600, '3h30m');
  ok(U.parseDur('7d') === 604800, '7d');
  ok(U.parseDur('45') === 2700, 'nackte Zahl = Minuten');
  ok(U.parseDur('quatsch') === 0, 'Unsinn ergibt 0');
  ok(U.fmtDur(20 * 60) === '20m' && U.fmtDur(3 * 3600) === '3h', 'zurueck als Text');
  ok(U.fmtClock(3661) === '1:01:01' && U.fmtClock(61) === '1:01', 'Countdown-Format');

  console.log('\n[Charakter + Timer]');
  click($('btnAddChar'));
  $('cdName').value = 'Testchar';
  $('cdOwner').value = 'Jogoe';
  click($('cdSave'));
  ok(DB.data.chars.length === 1, 'Charakter angelegt');
  ok(doc.querySelectorAll('#gridBody tr[data-char]').length === 1, 'eine Zeile in der Tabelle');
  const cells = doc.querySelectorAll('#gridBody tr[data-char] .chip');
  ok(cells.length === 6, 'sechs Zellen — eine je Run');
  ok(cells[0].textContent.trim() === 'Start', 'Hydra laeuft ab Start -> Knopf heisst "Start"');
  ok(cells[1].textContent.trim() === 'fertig', 'Nemere laeuft ab Abschluss -> "fertig"');

  click(cells[0]);
  const t = DB.data.timers[0];
  ok(DB.data.timers.length === 1, 'Timer angelegt');
  ok(t.run_key === 'hydra' && t.by_user === 'Jogoe', 'richtiger Run, Spieler vermerkt');
  const dauer = (Date.parse(t.ends_at) - Date.parse(t.started_at)) / 1000;
  ok(dauer === 1200, 'Hydra-Cooldown = 20 Minuten (' + dauer + 's)');
  const chip = doc.querySelector('#gridBody .chip.running');
  ok(!!chip && /^(19|20):/.test(chip.querySelector('.cd').textContent), 'Countdown laeuft: ' + chip.querySelector('.cd').textContent);

  console.log('\n[Timer bearbeiten]');
  click(chip);
  ok($('timerDlg').hidden === false, 'Timer-Dialog offen');
  $('tdRemain').value = '5m';
  click($('tdSet'));
  const left = (Date.parse(DB.data.timers[0].ends_at) - Date.now()) / 1000;
  ok(left > 290 && left <= 300, 'Restzeit auf 5 Minuten gesetzt (' + Math.round(left) + 's)');
  click(doc.querySelector('#gridBody .chip.running'));
  click($('tdClear'));
  ok(DB.data.timers.length === 0, 'Timer geloescht');
  ok(doc.querySelectorAll('#gridBody .chip.ready').length === 6, 'alle Zellen wieder "bereit"');

  console.log('\n[Alarm]');
  let rang = null;
  ALARM.fire = (key, title, body) => { rang = { key, title, body }; };
  ALARM.opts.sound = true;
  const jetzt = Date.now();
  DB.setTimer(DB.data.chars[0].id, 'nemere', jetzt - 7200000, jetzt - 1000, 'Jogoe');
  await new Promise((r) => setTimeout(r, 700));   // der 500-ms-Tick der App laeuft weiter
  ok(rang && rang.title.indexOf('Nemere') === 0, 'Alarm ausgeloest: ' + (rang && rang.title));
  ok(rang && /bereit/.test(rang.body), 'Text sagt "wieder bereit"');
  rang = null;
  await new Promise((r) => setTimeout(r, 700));
  ok(rang === null, 'klingelt nicht in jedem Tick erneut');

  console.log('\n[Channels]');
  const tick = CH.tick('2026-08-11 10:47:49');
  ok(tick.minute === 47 && tick.second === 49, 'Neustart-Minute gelesen');
  const now = new Date('2026-08-18T12:47:00');
  ok(CH.secondsToNext(tick, now) === 49, 'noch 49 s bis :47:49');
  ok(CH.secondsToNext(tick, new Date('2026-08-18T12:48:00')) === 3589, 'nach dem Spawn zaehlt die naechste Stunde');
  DB.data.channels = [
    { server: 'Germania', channel: 'CH1', status: 'online', last_restart: '2026-08-11 11:57:18', fetched_at: new Date().toISOString() },
    { server: 'Germania', channel: 'CH3', status: 'online', last_restart: '2026-08-11 10:47:49', fetched_at: new Date().toISOString() }
  ];
  const rows = CH.forServer(DB.data.channels, 'Germania', now);
  ok(rows[0].borrowedFrom === 'CH3', 'CH1 borgt sich CH3');
  ok(rows[0].tick.minute === 47, 'CH1 rechnet mit CH3s Minute, nicht mit 57');
  ok(rows[5].tick === null, 'CH6 ohne Daten bleibt leer');

  console.log('\n[Gate]');
  const dom2 = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom2.window.eval(fs.readFileSync(path.join(__dirname, 'gate.js'), 'utf8'));
  ok(dom2.window.document.body.classList.contains('locked'), 'ohne Passwort bleibt die Seite gesperrt');
  const form = dom2.window.document.querySelector('.gate-box');
  dom2.window.document.getElementById('gateUser').value = 'Wer';
  dom2.window.document.getElementById('gatePass').value = 'falsch';
  form.dispatchEvent(new dom2.window.Event('submit', { bubbles: true, cancelable: true }));
  ok(dom2.window.document.body.classList.contains('locked'), 'falsches Passwort sperrt weiter');
  ok(!dom2.window.document.getElementById('gateErr').hidden, 'Fehlermeldung sichtbar');

  console.log('\n' + (fails ? fails + ' Fehler' : 'alles gruen'));
  process.exitCode = fails ? 1 : 0;
  dom.window.close();
  dom2.window.close();
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
