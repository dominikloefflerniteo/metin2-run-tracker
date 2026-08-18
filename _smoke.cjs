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
  ok($('chBlock').hidden === !CH.SHOW_CHANNELS, 'g-status-Channels folgen dem Schalter CH.SHOW_CHANNELS (' + CH.SHOW_CHANNELS + ')');
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
  ok([...cells].every(c => c.textContent.trim() === 'starten'), 'alle Knoepfe heissen "starten"');
  ok(/ab Start/.test(doc.querySelectorAll('#gridHead .run-sub')[0].textContent),
     'Hydras Spaltenkopf sagt "ab Start"');
  ok(!/ab Start/.test(doc.querySelectorAll('#gridHead .run-sub')[1].textContent),
     'Nemere nicht');

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

  console.log('\n[Login / wer sitzt drauf]');
  const charRow = () => doc.querySelector('#gridBody tr[data-char]');
  const loginBtn = () => charRow().querySelector('.login[data-login]');
  const logoutBtn = () => charRow().querySelector('.login[data-logout]');

  ok(loginBtn().textContent === 'Login', 'frei: der Knopf heißt "Login"');
  ok(!logoutBtn(), 'und es gibt keinen Logout-Knopf');

  click(loginBtn());
  let ch = DB.data.chars[0];
  ok(ch.logged_in_by === 'Jogoe', 'eingeloggt als Jogoe');
  ok(!!ch.logged_in_at, 'mit Zeitstempel');
  ok(/^du · \d\d:\d\d$/.test(loginBtn().textContent), 'zeigt "du · Uhrzeit": ' + loginBtn().textContent);
  ok(loginBtn().classList.contains('mine'), 'eigener Login ist hervorgehoben');
  ok(!!logoutBtn(), 'jetzt gibt es einen Logout-Knopf');

  ok(ch.owner === 'Jogoe', 'Login übernimmt auch den Besitz (steht unter meinem Namen)');

  click(loginBtn());
  ok(DB.data.chars[0].logged_in_by === 'Jogoe', 'nochmal Login ändert nichts (dafür ist Logout da)');

  click(logoutBtn());
  ch = DB.data.chars[0];
  ok(ch.logged_in_by === null, 'ausgeloggt — der Charakter gehört wieder niemandem');
  ok(ch.logged_in_at === null, 'Zeitstempel geleert');
  ok(loginBtn().textContent === 'Login', 'Knopf wieder auf "Login"');

  // Fremder Login: Übernahme nur nach Rückfrage.
  DB.setLogin(ch.id, 'Dejan');
  ok(loginBtn().textContent.indexOf('Dejan') === 0, 'fremder Login zeigt den Namen: ' + loginBtn().textContent);
  ok(!loginBtn().classList.contains('mine'), 'und ist anders eingefärbt als der eigene');

  window.confirm = () => false;
  click(loginBtn());
  ok(DB.data.chars[0].logged_in_by === 'Dejan', 'abgelehnte Rückfrage übernimmt nicht');
  window.confirm = () => true;
  click(loginBtn());
  ok(DB.data.chars[0].logged_in_by === 'Jogoe', 'bestätigte Rückfrage übernimmt');
  ok(DB.data.chars[0].owner === 'Jogoe', 'und der Besitz wandert mit');
  click(logoutBtn());
  ok(DB.data.chars[0].owner === 'Jogoe', 'Logout lässt den Besitz stehen');
  ok(DB.data.chars[0].name === 'Testchar', 'Teiländerung lässt den Namen unangetastet');

  console.log('\n[Anmeldung / Regi]');
  const cellOf = (run) => [...doc.querySelectorAll('#gridBody tr[data-char] td')]
    .find((td) => td.querySelector('button[data-run="' + run + '"]'));
  ok(!!cellOf('meley').querySelector('.regi'), 'Meley hat einen Regi-Knopf');
  ok(!cellOf('nemere').querySelector('.regi'), 'Nemere hat keinen');

  click(cellOf('meley').querySelector('.regi'));
  let mt = DB.timerFor(DB.data.chars[0].id, 'meley');
  ok(!!(mt && mt.registered_at), 'Anmeldung gespeichert');
  ok(mt.ends_at === null, 'ohne laufenden Cooldown — die Zeile traegt nur die Regi');
  const regiBtn = cellOf('meley').querySelector('.regi');
  ok(/^✓ Regi \d/.test(regiBtn.textContent), 'Uhrzeit steht im Knopf: ' + regiBtn.textContent);
  ok(regiBtn.classList.contains('set'), 'als gesetzt markiert');
  ok(!!cellOf('meley').querySelector('.chip.ready'), 'der Cooldown-Knopf bleibt daneben bedienbar');

  // Den Lauf starten verbraucht die Anmeldung.
  click(cellOf('meley').querySelector('.chip'));
  mt = DB.timerFor(DB.data.chars[0].id, 'meley');
  ok(mt.registered_at === null, 'mit dem Lauf ist die Anmeldung verbraucht');
  ok((Date.parse(mt.ends_at) - Date.parse(mt.started_at)) / 1000 === 10800, 'Meley-Cooldown = 3 h');

  // Regi wieder setzen, dann Cooldown loeschen -> Zeile bleibt wegen der Regi.
  click(cellOf('meley').querySelector('.regi'));
  DB.clearTimer(DB.data.chars[0].id, 'meley');
  mt = DB.timerFor(DB.data.chars[0].id, 'meley');
  ok(!!(mt && mt.registered_at && !mt.ends_at), 'Timer geloescht, Anmeldung bleibt');
  DB.setRegistration(DB.data.chars[0].id, 'meley', null);
  DB.clearTimer(DB.data.chars[0].id, 'meley');
  ok(DB.timerFor(DB.data.chars[0].id, 'meley') === null, 'ohne beides verschwindet die Zeile');

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

  console.log('\n[Eigene Spawns]');
  ok(JSON.stringify(CH.parseSpawnTime('39:30')) === '{"minute":39,"second":30,"period_sec":3600}', '"39:30"');
  ok(CH.parseSpawnTime('min39:30').minute === 39, '"min39:30" (so wie Dominik tippt)');
  ok(CH.parseSpawnTime(':39').second === 0, '":39" = Minute 39, Sekunde 0');
  ok(CH.parseSpawnTime('7').minute === 7, 'nackte Minute');
  ok(CH.parseSpawnTime('39:30 /30m').period_sec === 1800, 'halbstündlich per "/30m"');
  ok(CH.parseSpawnTime('39:30 alle 15m').period_sec === 900, '"alle 15m" geht auch');
  ok(CH.parseSpawnTime('quatsch') === null, 'Unsinn wird abgelehnt');
  ok(CH.parseSpawnTime('99:99') === null, 'unmögliche Zeit wird abgelehnt');

  const t2 = { minute: 39, second: 30 };
  ok(CH.secondsToNext(t2, new Date('2026-08-18T14:39:00')) === 30, 'stündlich: 30 s bis :39:30');
  ok(CH.secondsToNext(t2, new Date('2026-08-18T14:40:00')) === 3570, 'nach dem Spawn die nächste Stunde');
  ok(CH.secondsToNext(t2, new Date('2026-08-18T14:10:00'), 1800) === 1770, 'halbstündlich trifft auch :09:30');
  ok(CH.secondsToNext(t2, new Date('2026-08-18T14:05:00'), 1800) === 270, 'und zwar als nächster Termin');

  $('spLabel').value = 'Metins Wald CH1';
  $('spTime').value = 'min39:30';
  $('spawnAdd').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok(DB.data.spawns.length === 1, 'Spawn gespeichert');
  ok(DB.data.spawns[0].minute === 39 && DB.data.spawns[0].second === 30, 'Zeit übernommen');
  ok(DB.data.spawns[0].by_user === 'Jogoe', 'Ersteller vermerkt');
  const spRow = doc.querySelector('#spawnList .sprow');
  ok(!!spRow && spRow.querySelector('.spname').textContent === 'Metins Wald CH1', 'steht in der Seitenspalte');
  ok(/^\d+:\d\d/.test(spRow.querySelector('.chcd').textContent), 'mit Countdown: ' + spRow.querySelector('.chcd').textContent);
  ok(/^\d\d:\d\d$/.test(spRow.querySelector('.chat').textContent), 'und mit Uhrzeit: ' + spRow.querySelector('.chat').textContent);
  ok($('spLabel').value === '' && $('spTime').value === '', 'Formular wieder leer');

  $('spLabel').value = 'Kaputt';
  $('spTime').value = 'irgendwas';
  $('spawnAdd').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok(DB.data.spawns.length === 1, 'unverständliche Zeit legt nichts an');
  ok($('spHint').classList.contains('bad'), 'und sagt es im Hinweis');

  CH.SHOW_CHANNELS = true;                     // kurz einschalten, um die Zeile zu pruefen
  DB.data.channels = [{ server: CH.SERVER, channel: 'CH3', status: 'online', last_restart: '2026-08-11 10:47:49', fetched_at: new Date().toISOString() }];
  click($('btnAddChar')); $('cdClose').click();  // irgendein Ereignis -> neu zeichnen
  DB.saveChar(DB.data.chars[0]);
  const chRow = doc.querySelector('#chGrid .chrow');
  ok(!!chRow && !!chRow.querySelector('.chat'), 'eingeschaltet zeigen auch die Channels die Uhrzeit');
  CH.SHOW_CHANNELS = false;

  window.confirm = () => true;
  // Zeile neu holen: zwischendurch wurde neu gezeichnet, die alte haengt frei.
  click(doc.querySelector('#spawnList .sprow .spdel'));
  ok(DB.data.spawns.length === 0, 'Spawn gelöscht');

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
