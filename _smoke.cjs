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
  for (const f of ['version.js', 'gate.js', 'util.js', 'db.js', 'channels.js', 'prices.js', 'alarm.js', 'app.js']) {
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

  console.log('\n[Version]');
  const v = window.APP_VERSION;
  ok(!!v && /^\d+\.\d+\.\d+$/.test(v.number), 'version.js nennt eine Version: ' + (v && v.number));
  ok($('appVersion').textContent === 'v' + v.number, 'steht oben links: ' + $('appVersion').textContent);
  const firstEntry = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8')
    .split('\n').find((l) => l.startsWith('## '));
  ok(!!firstEntry && firstEntry.indexOf('## ' + v.number + ' ') === 0,
     'CHANGELOG.md beginnt mit derselben Version ("' + firstEntry + '")');
  ok(firstEntry.indexOf(v.date) !== -1, 'und mit demselben Datum');

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

  console.log('\n[Notizen, Account, Gruppierung]');
  const groups = () => [...doc.querySelectorAll('#gridBody .grouprow td')].map((td) => td.textContent);

  // Zweiter Charakter, damit es etwas zu gruppieren gibt.
  click($('btnAddChar'));
  $('cdName').value = 'Zweitchar';
  $('cdOwner').value = 'Dejan';
  $('cdAccount').value = 'jogoe2';
  click($('cdSave'));
  ok(DB.data.chars.length === 2, 'zweiter Charakter angelegt');
  ok(DB.data.chars.find((c) => c.name === 'Zweitchar').account === 'jogoe2', 'Account gespeichert');

  ok(groups().indexOf('Nicht eingeloggt') !== -1,
     'ausgeloggte Charaktere stehen unter "Nicht eingeloggt": ' + JSON.stringify(groups()));

  DB.setLogin(DB.data.chars[0].id, 'Jogoe');
  ok(groups()[0] === 'Jogoe', 'eingeloggt -> eigene Gruppe zuoberst: ' + JSON.stringify(groups()));
  ok(groups()[groups().length - 1] === 'Nicht eingeloggt', '"Nicht eingeloggt" bleibt am Ende');

  // Umschalten auf Account
  click(doc.querySelector('#groupBy button[data-group="account"]'));
  ok(groups().indexOf('jogoe2') !== -1, 'nach Account gruppiert: ' + JSON.stringify(groups()));
  ok(groups().indexOf('ohne Account') !== -1, 'Charaktere ohne Account bekommen eine eigene Gruppe');
  ok(doc.querySelector('#groupBy button[data-group="account"]').classList.contains('on'),
     'der Umschalter zeigt die aktive Wahl');
  click(doc.querySelector('#groupBy button[data-group="player"]'));

  // Notizen direkt in der Tabelle
  const noteIn = doc.querySelector('#gridBody input[data-note]');
  ok(!!noteIn, 'jede Zeile hat ein Notizfeld');
  noteIn.value = 'braucht noch Bio';
  noteIn.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(DB.data.chars.find((c) => c.id === noteIn.dataset.note).note === 'braucht noch Bio',
     'Notiz gespeichert');
  ok(DB.data.chars.find((c) => c.id === noteIn.dataset.note).name !== undefined,
     'und der Charakter ist sonst unangetastet');

  DB.setLogin(DB.data.chars[0].id, null);
  DB.deleteChar(DB.data.chars.find((c) => c.name === 'Zweitchar').id);

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

  console.log('\n[Truhenwerte]');
  // Preise kommen sonst vom Push-Job; hier von Hand gesetzt.
  const WON = 100000000;
  DB.data.chest_values = [
    { server: 'x', vnum: 54703, name: 'Truhe des Nemere', expected_value: 20000000,
      chest_price: 9000000, fetched_at: new Date().toISOString() },
    { server: 'x', vnum: 99999, name: 'Schluesselkiste', expected_value: 1000000,
      chest_price: 0, fetched_at: new Date().toISOString() }
  ];
  DB.data.item_prices = [];
  DB.data.run_loot = [
    { id: 'l1', run_key: 'nemere', vnum: 54703, name: 'Truhe des Nemere', kind: 'chest', qty: 9, is_cost: false, sort: 10 },
    { id: 'l2', run_key: 'nemere', vnum: 99999, name: 'Schluesselkiste', kind: 'chest', qty: 2, is_cost: true, sort: 20 }
  ];

  const nem = window.PRICES.valueFor('nemere');
  ok(nem.gain === 180000000, '9 Truhen à 20 Mio = 180 Mio Ertrag');
  ok(nem.cost === 2000000, 'Kosten werden getrennt gezaehlt (2 × 1 Mio)');
  ok(nem.perRun === 178000000, 'Wert pro Run = Ertrag minus Kosten: ' + window.PRICES.fmt(nem.perRun));
  ok(Math.round(nem.perHour) === 44500000, 'ueber den Cooldown (4h): ' + window.PRICES.fmtShort(nem.perHour) + '/h');
  ok(nem.perHourActive === null, 'ohne Laufzeit gibt es keinen Laufzeit-Wert');
  ok(window.PRICES.valueFor('bio') === null, 'ein Run ohne Beute liefert null');

  // Laufzeit eintragen -> die eigene Stunde zaehlt, nicht der Cooldown.
  const rtNem = DB.data.run_types.find((r) => r.key === 'nemere');
  rtNem.run_seconds = 20 * 60;
  const nem2 = window.PRICES.valueFor('nemere');
  ok(Math.round(nem2.perHourActive) === 534000000, '20 min Laufzeit -> ' + window.PRICES.fmtShort(nem2.perHourActive) + '/h');
  ok(window.PRICES.ranking()[0].runKey === 'nemere', 'Rangliste fuehrt Nemere');

  // Pauschale: fuer Runs ohne handelbare Truhe (Meley) ist die Menge der Wert.
  DB.data.run_loot.push({ id: 'l3', run_key: 'meley', vnum: 0, name: 'Pauschal 3,5 Won',
                          kind: 'fixed', qty: 3.5 * WON, is_cost: false, sort: 10 });
  const mel = window.PRICES.valueFor('meley');
  ok(mel.perRun === 350000000, 'Pauschale zaehlt direkt: ' + window.PRICES.fmt(mel.perRun));
  ok(mel.missing === 0, 'und gilt nicht als fehlender Preis');
  ok(window.PRICES.parseYang('3,5 Won') === 350000000, '"3,5 Won" wird verstanden');
  ok(window.PRICES.parseYang('20 Mio') === 20000000, '"20 Mio" auch');
  ok(window.PRICES.parseYang('quatsch') === 0, 'Unsinn ergibt 0');

  ok(window.PRICES.fmt(1.21 * WON).indexOf('Won') !== -1, 'ab 100 Mio wird in Won angezeigt: ' + window.PRICES.fmt(1.21 * WON));
  ok(window.PRICES.fmt(4952511).indexOf('Yang') !== -1, 'darunter in Yang: ' + window.PRICES.fmt(4952511));
  ok(window.PRICES.ageClass(60) === 'fresh' && window.PRICES.ageClass(3600) === 'ok' &&
     window.PRICES.ageClass(99999) === 'stale' && window.PRICES.ageClass(null) === 'none',
     'Alter der Preise wird eingestuft');

  // Neuzeichnen ueber den normalen Weg: die Filtereingabe ruft render() auf.
  $('filter').dispatchEvent(new window.Event('input', { bubbles: true }));
  click(doc.querySelector('#tabs .tab[data-view="bazar"]'));
  ok(!$('viewBazar').hidden && $('viewRuns').hidden, 'der Reiter Bazar schaltet die Ansicht um');
  ok($('bzBody').textContent.indexOf('Was lohnt sich') !== -1, 'dort steht die Rangliste');
  ok($('bzBody').textContent.indexOf('Nemere') !== -1, 'mit Nemere');
  ok($('bzBody').textContent.indexOf('Truhen') !== -1, 'dazu die Truhen-Uebersicht');
  ok($('bzAge').className.indexOf('age-fresh') !== -1, 'frische Preise werden gruen markiert');
  ok(doc.querySelector('#gridHead .run-val') !== null, 'der Wert steht auch im Spaltenkopf');

  console.log('\n[Aufschlüsselung]');
  // Truhe mit Drops, damit es etwas aufzuschluesseln gibt: 10 % auf ein Item
  // zu 50 Mio plus ein unverkaeufliches, das mit 0 zaehlt.
  DB.data.chest_values[0].drops = [
    { vnum: 111, name: 'Teuer', qty: 1, rate: 10, unit: 50000000, ev: 5000000, priced: true, untradeable: false },
    { vnum: 222, name: 'Unverkäuflich', qty: 2, rate: 5, unit: 0, ev: 0, priced: false, untradeable: true }
  ];
  DB.data.chest_values[0].openings = 1;
  ok(window.PRICES.chestEV(DB.data.chest_values[0]) === 5000000,
     'Erwartungswert wird aus den Drops nachgerechnet: ' + window.PRICES.fmt(5000000));

  // Dasselbe Item mehrfach in der Droptabelle -> eine Zeile, Raten addiert.
  DB.data.chest_values[0].drops.push(
    { vnum: 111, name: 'Teuer', qty: 1, rate: 10, unit: 50000000, ev: 5000000, priced: true, untradeable: false });
  const br = window.PRICES.chestBreakdown(DB.data.chest_values[0]);
  ok(br.length === 2, 'doppelter Eintrag wird zu einer Zeile zusammengefasst');
  ok(br[0].rate === 20 && br[0].rows === 2, 'die Raten werden addiert (2 × 10 % = 20 %)');
  ok(window.PRICES.chestEV(DB.data.chest_values[0]) === 10000000,
     'und der Erwartungswert zaehlt beide: ' + window.PRICES.fmt(10000000));
  DB.data.chest_values[0].drops.pop();

  click(doc.querySelector('#gridHead .valinfo'));
  ok($('valueDlg').hidden === false, 'der Knopf im Spaltenkopf öffnet die Aufschlüsselung');
  ok($('vdBody').textContent.indexOf('Unverkäuflich') !== -1, 'auch Drops ohne Preis stehen drin');
  ok($('vdBody').textContent.indexOf('Marktpreis') !== -1, 'Marktpreis der Truhe zum Vergleich');
  ok($('vdBody').textContent.indexOf('verkaufen') !== -1,
     'und ein Fazit (9 Mio Kauf gegen 5 Mio Erwartungswert -> verkaufen)');

  // Preis von Hand setzen: wirkt sofort, ohne auf den naechsten Push zu warten.
  // Preisfelder, nicht die "zählt"-Haken: das letzte gehoert dem Drop ohne Preis.
  const inputs = [...$('vdBody').querySelectorAll('.mini.drops input.txt')];
  const unverk = inputs[inputs.length - 1];
  unverk.value = '10 Mio';
  unverk.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok(DB.data.price_overrides.length === 1, 'Überschreibung gespeichert');
  ok(window.PRICES.override(222) === 10000000, 'und wird gefunden: ' + window.PRICES.fmt(10000000));
  ok(window.PRICES.chestEV(DB.data.chest_values[0]) === 6000000,
     'der Erwartungswert steigt sofort (2 × 10 Mio × 5 %): ' + window.PRICES.fmt(window.PRICES.chestEV(DB.data.chest_values[0])));

  // "zählt nicht": faellt ganz aus der Rechnung, der gesetzte Preis bleibt aber stehen.
  DB.setPriceIgnored(111, true, 'Teuer', 'Jogoe');
  ok(window.PRICES.ignored(111), 'Drop ist abgewählt');
  ok(window.PRICES.chestEV(DB.data.chest_values[0]) === 1000000,
     'der teure Drop faellt raus, nur der ueberschriebene bleibt: ' +
     window.PRICES.fmt(window.PRICES.chestEV(DB.data.chest_values[0])));
  DB.setPriceIgnored(111, false);
  ok(DB.data.price_overrides.filter((o) => Number(o.vnum) === 111).length === 0,
     'wieder mitgezaehlt -> die Zeile verschwindet, weil nichts mehr zu merken ist');
  ok(window.PRICES.chestEV(DB.data.chest_values[0]) === 6000000, 'und der Wert ist zurueck');

  DB.setPriceOverride(222, 0);
  ok(DB.data.price_overrides.length === 0, 'leeres Feld nimmt die Überschreibung wieder zurück');
  click($('vdClose'));
  ok($('valueDlg').hidden === true, 'Fenster schließt');

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
