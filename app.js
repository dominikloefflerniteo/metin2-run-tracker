/* Oberflaeche + Ablauf. Bewusst kein Framework und kein ES-Modul: die Seite
   soll auch per Doppelklick von der Platte laufen. */
(function () {
  'use strict';

  var $ = U.$;

  var PREF_KEY = 'm2rt.prefs.v1';
  var prefs = Object.assign({
    onlyMine: false,
    groupBy: 'player',        // 'player' = wer eingeloggt ist, 'account'
    view: 'runs',             // 'runs' = Timer-Tabelle, 'bazar' = Preise
    filter: ''
  }, U.store.get(PREF_KEY, {}));

  function savePrefs() { U.store.set(PREF_KEY, prefs); }

  var FREE = 'Nicht eingeloggt';
  var NO_ACCOUNT = 'ohne Account';

  /* Was schon geklingelt hat — sonst laeutet es bei jedem Tick erneut. */
  var fired = {};

  var dlgChar = null;     // aktuell bearbeiteter Char
  var dlgTimer = null;    // { charId, runKey }

  /* ==================================================== Kopfzeile / Setup */

  function paintVersion() {
    var v = window.APP_VERSION;
    if (!v) return;
    var el = $('appVersion');
    el.textContent = 'v' + v.number;
    el.title = 'v' + v.number + ' · ' + v.date + (v.note ? ' — ' + v.note : '');
  }

  function paintWho() {
    $('btnWho').textContent = ZGATE.user() || 'Name?';
  }

  function paintStatus(st) {
    $('syncDot').className = 'dot ' + st.state;
    $('syncText').textContent = st.text;
  }

  /* ============================================================== Tabelle */

  function chars() {
    var q = prefs.filter.trim().toLowerCase();
    var me = ZGATE.user().toLowerCase();
    return DB.data.chars
      .filter(function (c) { return !prefs.onlyMine || (c.owner || '').toLowerCase() === me; })
      .filter(function (c) {
        if (!q) return true;
        return (c.name + ' ' + (c.owner || '') + ' ' + (c.note || '')).toLowerCase().indexOf(q) !== -1;
      })
      .sort(function (a, b) {
        var g = groupKey(a).localeCompare(groupKey(b));
        // "Nicht eingeloggt" ans Ende, sonst alphabetisch nach Gruppe.
        var la = groupKey(a) === FREE, lb = groupKey(b) === FREE;
        if (la !== lb) return la ? 1 : -1;
        if (g) return g;
        return (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);
      });
  }

  /* Ueberschrift, unter der ein Charakter einsortiert wird.
     Nach Spieler heisst: wer gerade eingeloggt ist — nicht, wem er "gehoert".
     Genau das will man beim Draufschauen wissen. */
  function groupKey(c) {
    if (prefs.groupBy === 'account') return (c.account || '').trim() || NO_ACCOUNT;
    return (c.logged_in_by || '').trim() || FREE;
  }

  function buildHead(runs) {
    var tr = U.el('tr');
    tr.appendChild(U.el('th', 'th-char', 'Charakter'));
    tr.appendChild(U.el('th', 'th-note', 'Notizen'));
    runs.forEach(function (r) {
      var th = U.el('th', 'th-run');
      var box = U.el('span', 'run-head');
      var dot = U.el('span', 'run-dot');
      dot.style.background = r.color || '#888';
      box.appendChild(dot);
      box.appendChild(U.el('span', null, r.label));
      var sub = U.el('span', 'run-sub', U.fmtDur(r.seconds) + (r.from_start ? ' · ab Start' : ''));
      th.appendChild(box);
      th.appendChild(sub);

      // Wert des Runs, sofern Beute eingetragen ist. Yang/h ist die Zahl, mit
      // der sich zwei Runs vergleichen lassen — deshalb steht sie fett da.
      var val = PRICES.valueFor(r.key);
      if (val) {
        var v = U.el('span', 'run-val' + (val.perRun < 0 ? ' bad' : ''));
        // Fett steht die Zahl, nach der man entscheidet: gibt es eine
        // Laufzeit, ist das die eigene Stunde — sonst bleibt der Cooldown.
        var lead = val.perHourActive === null ? val.perHour : val.perHourActive;
        v.appendChild(U.el('b', null, PRICES.fmtShort(lead) + '/h'));
        var second = PRICES.fmtShort(val.perRun) + '/Run';
        if (val.perHourActive !== null) {
          second += ' · ' + PRICES.fmtShort(val.perHour) + '/h CD';
        }
        v.appendChild(U.el('span', 'run-val-run', second));
        var info = U.el('button', 'valinfo', '?');
        info.title = 'aufschlüsseln: Truhen pro Run, jeder Drop und sein Wert';
        info.onclick = function (ev) { ev.stopPropagation(); openValueDlg(r.key); };
        v.appendChild(info);
        v.title = val.parts.map(function (p) {
          return (p.isCost ? '− ' : '') + p.qty + '× ' + p.name + ' = ' + PRICES.fmt(p.value);
        }).join('\n')
          + '\n\n' + PRICES.fmt(val.perRun) + ' pro Run'
          + (val.perHourActive !== null
              ? '\n' + PRICES.fmt(val.perHourActive) + '/h bei ' + U.fmtDur(val.runSeconds) + ' Laufzeit'
              : '\n(Laufzeit nicht eingetragen — Einstellungen → Runs)')
          + '\n' + PRICES.fmt(val.perHour) + '/h über den Cooldown (' + U.fmtDur(val.seconds) + ')'
          + (val.missing ? '\n\n' + val.missing + ' Position(en) ohne Preis' : '');
        th.appendChild(v);
      }
      tr.appendChild(th);
    });
    tr.appendChild(U.el('th', 'th-act', ''));
    var head = $('gridHead');
    head.innerHTML = '';
    head.appendChild(tr);
  }

  function cellFor(c, r) {
    var td = U.el('td', 'cell');
    var t = DB.timerFor(c.id, r.key);
    var btn = U.el('button');
    btn.dataset.char = c.id;
    btn.dataset.run = r.key;

    if (t && t.ends_at) {
      var end = Date.parse(t.ends_at);
      var left = (end - Date.now()) / 1000;
      if (left > 0) {
        btn.className = 'chip running';
        btn.style.borderColor = r.color || '';
        btn.dataset.ends = String(end);
        btn.innerHTML = '<b class="cd">' + U.fmtClock(left) + '</b>' +
                        '<span class="at">' + U.fmtTime(end) + '</span>';
        btn.title = (t.by_user ? t.by_user + ' · ' : '') +
                    'gestartet ' + U.fmtTime(t.started_at) + ' — klicken zum Ändern';
        td.appendChild(btn);
        addRegi(td, c, r, t);
        return td;
      }
    }

    btn.className = 'chip ready';
    btn.style.background = (r.color || '#3aaac1') + '22';
    btn.style.borderColor = r.color || '';
    // Ein Wort fuer alle Runs: der Knopf startet immer denselben Cooldown.
    // Ob der im Spiel beim Betreten oder beim Abschluss beginnt, steht in der
    // Spaltenueberschrift und im Tooltip — nicht auf dem Knopf.
    btn.innerHTML = '<b>starten</b>';
    btn.title = (r.from_start
      ? 'Lauf betreten — '
      : 'Lauf abgeschlossen bzw. abgegeben — ') +
      'Cooldown läuft ab jetzt (' + U.fmtDur(r.seconds) + ')';
    td.appendChild(btn);
    addRegi(td, c, r, t);
    return td;
  }

  /* Anmeldung: nur bei Runs, die eine haben (Meley). Ist sie gesetzt, steht
     dort die Uhrzeit statt des Knopfs — ein Klick darauf setzt sie zurueck. */
  function addRegi(td, c, r, t) {
    if (!r.has_registration) return;

    var b = U.el('button', 'regi');
    b.dataset.char = c.id;
    b.dataset.run = r.key;
    b.dataset.regi = '1';

    if (t && t.registered_at) {
      b.classList.add('set');
      b.textContent = '✓ Regi ' + U.fmtTime(t.registered_at);
      b.title = 'angemeldet am ' + new Date(t.registered_at).toLocaleString('de-AT') +
                ' — klicken zum Zurücksetzen';
    } else {
      b.textContent = 'Regi gemacht';
      b.title = 'Anmeldung eintragen (Uhrzeit von jetzt)';
    }
    td.appendChild(b);
  }

  /* Wer sitzt gerade auf dem Charakter?
     - frei:            [Login]
     - ich bin drauf:   [du · 14:20] [Logout]
     - jemand anderes:  [Dejan · 14:20] [Logout]   (Klick auf den Namen uebernimmt)
     Ausgeloggt heisst: der Charakter gehoert gerade niemandem. */
  function loginControls(c, into) {
    var me = ZGATE.user();
    var who = c.logged_in_by || '';

    var b = U.el('button', 'login');
    b.dataset.login = c.id;

    if (!who) {
      b.textContent = 'Login';
      b.title = 'als eingeloggt markieren';
      into.appendChild(b);
      return;
    }

    var mine = who.toLowerCase() === me.toLowerCase();
    b.classList.add('on');
    if (mine) b.classList.add('mine');
    b.textContent = (mine ? 'du' : who) + (c.logged_in_at ? ' · ' + U.fmtTime(c.logged_in_at) : '');
    b.title = who + ' ist eingeloggt' +
              (c.logged_in_at ? ' seit ' + new Date(c.logged_in_at).toLocaleString('de-AT') : '') +
              (mine ? '' : ' — klicken, um zu übernehmen');
    into.appendChild(b);

    var out = U.el('button', 'login logout', 'Logout');
    out.dataset.logout = c.id;
    out.title = 'ausloggen — der Charakter ist dann frei';
    into.appendChild(out);
  }

  function doLogin(id) {
    var c = DB.data.chars.find(function (x) { return x.id === id; });
    if (!c) return;
    var me = ZGATE.user();
    var who = c.logged_in_by || '';

    if (who && who.toLowerCase() !== me.toLowerCase()) {
      if (!confirm(who + ' ist auf "' + c.name + '" eingeloggt. Übernehmen?')) return;
    } else if (who) {
      return;   // ich bin schon drauf — dafür gibt es den Logout-Knopf
    }
    DB.setLogin(id, me);
    render();
  }

  function doLogout(id) {
    DB.setLogin(id, null);
    render();
  }

  function render() {
    var runs = DB.runTypes();
    buildHead(runs);

    var body = $('gridBody');
    body.innerHTML = '';
    var list = chars();
    $('emptyHint').hidden = list.length > 0;

    var lastOwner = null;
    list.forEach(function (c) {
      if (groupKey(c) !== lastOwner) {
        lastOwner = groupKey(c);
        var gr = U.el('tr', 'grouprow' + (lastOwner === FREE ? ' free' : ''));
        var gd = U.el('td', null, lastOwner);
        gd.colSpan = runs.length + 3;
        gr.appendChild(gd);
        body.appendChild(gr);
      }

      var tr = U.el('tr');
      tr.dataset.char = c.id;

      var name = U.el('td', 'td-char');
      var line = U.el('div', 'charline');
      line.appendChild(U.el('b', null, c.name));
      loginControls(c, line);
      name.appendChild(line);
      if (prefs.groupBy === 'account' && c.logged_in_by) {
        name.appendChild(U.el('span', 'note', 'eingeloggt: ' + c.logged_in_by));
      } else if (prefs.groupBy === 'player' && c.account) {
        name.appendChild(U.el('span', 'note', 'Account ' + c.account));
      }
      tr.appendChild(name);

      var noteTd = U.el('td', 'td-note');
      var noteIn = U.el('input', 'noteinput');
      noteIn.value = c.note || '';
      noteIn.placeholder = 'Notiz…';
      noteIn.maxLength = 200;
      noteIn.dataset.note = c.id;
      noteTd.appendChild(noteIn);
      tr.appendChild(noteTd);

      runs.forEach(function (r) { tr.appendChild(cellFor(c, r)); });

      var act = U.el('td', 'td-act');
      var edit = U.el('button', 'btn tiny', '✎');
      edit.title = 'Charakter bearbeiten';
      edit.dataset.edit = c.id;
      act.appendChild(edit);
      tr.appendChild(act);

      body.appendChild(tr);
    });

    renderChannels();
    renderSpawns();
    paintTabBadge();
    checkHitAlarm();

    if (prefs.view === 'bazar') renderBazar();
  }

  /* Nur die Zahlen nachziehen — kein Neuaufbau, sonst flackert es und man
     verliert den Fokus im Eingabefeld. */
  function tick() {
    var now = Date.now();
    var stale = false;

    document.querySelectorAll('#gridBody .chip.running').forEach(function (btn) {
      var end = parseInt(btn.dataset.ends, 10);
      var left = (end - now) / 1000;
      if (left <= 0) { stale = true; return; }
      var cd = btn.querySelector('.cd');
      if (cd) cd.textContent = U.fmtClock(left);
      btn.classList.toggle('soon', left <= 300);
    });

    checkAlarms(now);
    tickChannels(now);
    tickSpawns(now);

    if (stale) render();   // ein Timer ist abgelaufen -> Zelle wird "fertig"
  }

  /* ============================================================== Alarme */

  function checkAlarms(now) {
    var lead = Math.max(0, ALARM.opts.lead || 0) * 1000;
    var runs = {};
    DB.data.run_types.forEach(function (r) { runs[r.key] = r; });

    DB.data.timers.forEach(function (t) {
      var c = DB.data.chars.find(function (x) { return x.id === t.char_id; });
      if (!c) return;
      var end = Date.parse(t.ends_at);
      if (!end) return;

      var mark = t.id + ':' + end;
      if (fired[mark]) return;
      if (now < end - lead) return;
      if (now > end + 120000) { fired[mark] = true; return; }  // alte Timer nicht nachtraeglich laeuten

      fired[mark] = true;
      var label = (runs[t.run_key] || {}).label || t.run_key;
      var soon = lead > 0 && now < end;
      ALARM.fire(t.run_key,
        label + ' — ' + c.name,
        soon ? ('in ' + U.fmtDur(Math.round((end - now) / 1000)) + ' wieder bereit')
             : 'ist wieder bereit');
    });
  }

  /* ============================================================ Channels */

  function renderChannels() {
    $('chBlock').hidden = !CH.SHOW_CHANNELS;
    if (!CH.SHOW_CHANNELS) return;
    $('chServer').textContent = CH.SERVER;
    var rows = CH.forServer(DB.data.channels, CH.SERVER);
    var list = $('chGrid');
    list.innerHTML = '';

    var known = rows.filter(function (r) { return r.tick; }).length;
    var age = CH.age(DB.data.channels, CH.SERVER);
    $('chMeta').textContent = !known
      ? 'keine Daten'
      : ('stündlich · Stand ' + (age === null ? '—' : U.fmtDur(age) + ' alt'));

    rows.forEach(function (r) {
      var li = U.el('li', 'chrow' + (r.status === 'offline' ? ' off' : ''));
      li.dataset.ch = r.channel;

      var dot = U.el('span', 'dot ' + (r.status === 'online' ? 'ok' : r.status === 'offline' ? 'bad' : 'off'));
      li.appendChild(dot);
      li.appendChild(U.el('span', 'chn', r.channel));
      li.appendChild(U.el('b', 'chcd', r.secondsToNext === null ? '—' : U.fmtClock(r.secondsToNext)));
      li.appendChild(U.el('span', 'chat', r.nextAt ? U.fmtTime(r.nextAt) : ''));

      if (r.tick) {
        var mm = (r.tick.minute < 10 ? '0' : '') + r.tick.minute;
        var ss = (r.tick.second < 10 ? '0' : '') + r.tick.second;
        li.title = 'jede Stunde :' + mm + ':' + ss +
                   (r.borrowedFrom ? ' (Zeit von ' + r.borrowedFrom + ')' : '') +
                   ' — letzter Neustart ' + r.lastRestart + ' (Serverzeit)';
      } else {
        li.title = 'kein Neustart bekannt';
      }
      list.appendChild(li);
    });
  }

  function tickChannels(now) {
    if (!CH.SHOW_CHANNELS) return;
    var rows = CH.forServer(DB.data.channels, CH.SERVER, new Date(now));
    var lead = Math.max(0, ALARM.opts.lead || 0);

    rows.forEach(function (r) {
      var li = document.querySelector('#chGrid .chrow[data-ch="' + r.channel + '"]');
      if (li) {
        var cd = li.querySelector('.chcd');
        if (cd) cd.textContent = r.secondsToNext === null ? '—' : U.fmtClock(r.secondsToNext);
        var at = li.querySelector('.chat');
        if (at) at.textContent = r.nextAt ? U.fmtTime(r.nextAt) : '';
        li.classList.toggle('soon', r.secondsToNext !== null && r.secondsToNext <= 120);
      }
      if (!ALARM.opts.spawn || r.secondsToNext === null) return;
      if (r.secondsToNext > Math.max(lead, 1)) return;

      // Pro Channel und Stunde nur einmal.
      var slot = CH.SERVER + ':' + r.channel + ':' + Math.floor((now + r.secondsToNext * 1000) / 3600000);
      if (fired[slot]) return;
      fired[slot] = true;
      ALARM.fire('_spawn', 'Spawn ' + r.channel + ' · ' + CH.SERVER,
        lead ? ('in ' + U.fmtDur(r.secondsToNext)) : 'jetzt');
    });
  }

  /* ------------------------------------------------------ eigene Spawns */

  function spawnRow(sp, now) {
    var tick = { minute: sp.minute, second: sp.second };
    var sec = CH.secondsToNext(tick, now, sp.period_sec);
    return { sec: sec, at: new Date(now.getTime() + sec * 1000) };
  }

  function renderSpawns() {
    var list = $('spawnList');
    list.innerHTML = '';
    var all = DB.spawns();
    $('spawnEmpty').hidden = all.length > 0;

    var now = new Date();
    all.forEach(function (sp) {
      var r = spawnRow(sp, now);

      var li = U.el('li', 'sprow');
      li.dataset.spawn = sp.id;

      var name = U.el('div', 'spname', sp.label);
      name.title = 'jede ' + (sp.period_sec === 3600 ? 'Stunde' : U.fmtDur(sp.period_sec)) +
                   ' bei :' + (sp.minute < 10 ? '0' : '') + sp.minute +
                   ':' + (sp.second < 10 ? '0' : '') + sp.second +
                   (sp.by_user ? ' · von ' + sp.by_user : '');
      li.appendChild(name);

      var line = U.el('div', 'spline');
      line.appendChild(U.el('b', 'chcd', U.fmtClock(r.sec)));
      line.appendChild(U.el('span', 'chat', U.fmtTime(r.at)));
      var del = U.el('button', 'spdel', '×');
      del.title = 'Spawn löschen (für alle)';
      del.dataset.del = sp.id;
      line.appendChild(del);
      li.appendChild(line);

      list.appendChild(li);
    });
  }

  function tickSpawns(now) {
    var lead = Math.max(0, ALARM.opts.lead || 0);
    var d = new Date(now);

    DB.spawns().forEach(function (sp) {
      var r = spawnRow(sp, d);
      var li = document.querySelector('#spawnList .sprow[data-spawn="' + sp.id + '"]');
      if (li) {
        li.querySelector('.chcd').textContent = U.fmtClock(r.sec);
        li.querySelector('.chat').textContent = U.fmtTime(r.at);
        li.classList.toggle('soon', r.sec <= 120);
      }
      if (!ALARM.opts.spawn) return;
      if (r.sec > Math.max(lead, 1)) return;

      var slot = 'sp:' + sp.id + ':' + Math.round(r.at.getTime() / 1000);
      if (fired[slot]) return;
      fired[slot] = true;
      ALARM.fire('_spawn', 'Spawn ' + sp.label, lead ? ('in ' + U.fmtDur(r.sec)) : 'jetzt');
    });
  }

  /* ======================================================== Timer setzen */

  function startTimer(charId, runKey) {
    var r = DB.data.run_types.find(function (x) { return x.key === runKey; });
    if (!r) return;
    var now = Date.now();
    DB.setTimer(charId, runKey, now, now + r.seconds * 1000, ZGATE.user());
    render();
  }

  function openTimerDialog(charId, runKey) {
    dlgTimer = { charId: charId, runKey: runKey };
    var c = DB.data.chars.find(function (x) { return x.id === charId; });
    var r = DB.data.run_types.find(function (x) { return x.key === runKey; });
    var t = DB.timerFor(charId, runKey);
    if (!c || !r) return;

    $('tdTitle').textContent = r.label + ' · ' + c.name;
    $('tdInfo').textContent = (t && t.ends_at)
      ? ('läuft bis ' + U.fmtTime(t.ends_at) +
         (t.by_user ? ' · gestartet von ' + t.by_user : '') +
         ' · Vorgabe ' + U.fmtDur(r.seconds))
      : ('kein Timer · Vorgabe ' + U.fmtDur(r.seconds));
    $('tdRemain').value = (t && t.ends_at)
      ? U.fmtDur((Date.parse(t.ends_at) - Date.now()) / 1000)
      : U.fmtDur(r.seconds);

    $('tdRegiRow').hidden = !r.has_registration;
    if (r.has_registration) {
      var reg = t && t.registered_at;
      $('tdRegi').textContent = reg
        ? ('Anmeldung: ' + new Date(reg).toLocaleString('de-AT'))
        : 'keine Anmeldung eingetragen';
      $('tdRegiSet').textContent = reg ? 'Regi zurücksetzen' : 'Regi gemacht';
    }
    $('timerDlg').hidden = false;
    $('tdRemain').focus();
  }

  /* ============================================================== Dialoge */

  function openCharDialog(id) {
    var c = id ? DB.data.chars.find(function (x) { return x.id === id; }) : null;
    dlgChar = c || {
      id: U.uuid(), name: '', server: CH.SERVER,
      owner: ZGATE.user(), note: '', account: '', sort: DB.data.chars.length
    };
    $('cdTitle').textContent = c ? 'Charakter bearbeiten' : 'Neuer Charakter';
    $('cdName').value = dlgChar.name;
    $('cdOwner').value = dlgChar.owner || '';
    $('cdAccount').value = dlgChar.account || '';
    $('cdNote').value = dlgChar.note || '';
    $('cdDelete').hidden = !c;
    $('charDlg').hidden = false;
    $('cdName').focus();
  }

  /* ============================================================== Bazar
   *
   * Alles, was mit Preisen zu tun hat, in einem eigenen Reiter: was ein Run
   * einbringt, was jede Truhe wert ist, und ob sich ein Drachenstein-Aufstieg
   * rechnet. Die Runs-Ansicht bleibt damit das, was sie war — eine Tabelle
   * mit Timern.
   */
  function renderBazar() {
    var body = $('bzBody');
    body.innerHTML = '';

    var age = PRICES.age();
    var lbl = $('bzAge');
    lbl.textContent = age === null ? 'noch keine Preise' : 'Preise ' + U.fmtDur(age) + ' alt';
    lbl.className = 'dim age-' + PRICES.ageClass(age);
    lbl.title = 'Die Preise entstehen auf Dominiks PC (metin-bazar-pro) und werden alle ' +
                '10 Minuten frisch gerechnet. Läuft er nicht, stehen sie still.';

    if (age === null) {
      body.appendChild(U.el('p', 'empty',
        'Noch keine Marktdaten. Sie kommen vom Rechner, der metin-bazar-pro laufen lässt.'));
      return;
    }

    bazarHits(body);
    bazarWatchlist(body);
    bazarRuns(body);
    bazarChests(body);
    bazarAlchemy(body);
  }

  /* --- Treffer aus der Watchlist --- */
  function bazarHits(body) {
    var hits = PRICES.hits(false).slice(0, 50);
    if (!hits.length) return;

    var unseen = PRICES.unseenCount();
    var sec = U.el('section', 'card');
    var lab = U.el('div', 'label', 'Treffer');
    if (unseen) lab.appendChild(U.el('span', 'badge', String(unseen) + ' neu'));
    sec.appendChild(lab);

    var row = U.el('div', 'row');
    var bSeen = U.el('button', 'btn tiny', 'alle gelesen');
    bSeen.onclick = function () { DB.markHitsSeen(); renderBazar(); };
    row.appendChild(bSeen);
    var bClear = U.el('button', 'btn tiny danger', 'Liste leeren');
    bClear.onclick = function () {
      if (!confirm('Alle Treffer löschen? Das gilt für alle.')) return;
      DB.deleteHits(); renderBazar();
    };
    row.appendChild(bClear);
    sec.appendChild(row);

    var t = U.el('table', 'mini hits');
    var hr = U.el('tr');
    ['', 'gefunden', 'Item', 'Boni', 'Verkäufer', 'Preis'].forEach(function (h) {
      hr.appendChild(U.el('th', null, h));
    });
    t.appendChild(hr);

    hits.forEach(function (h) {
      var tr = U.el('tr', h.seen ? 'seen' : 'fresh');
      var tdM = U.el('td');
      var dot = U.el('button', 'hitdot' + (h.seen ? '' : ' on'));
      dot.title = h.seen ? 'gelesen' : 'als gelesen markieren';
      dot.onclick = function () { DB.markHitsSeen(h.id); renderBazar(); };
      tdM.appendChild(dot); tr.appendChild(tdM);

      tr.appendChild(U.el('td', 'dim', U.fmtTime(h.found_at)));
      tr.appendChild(U.el('td', null, h.name + (h.quantity > 1 ? ' ×' + h.quantity : '')));
      var tdA = U.el('td', 'dim', PRICES.attrText(h.attrs));
      tdA.title = h.label;
      tr.appendChild(tdA);
      tr.appendChild(U.el('td', 'dim', h.seller));
      tr.appendChild(U.el('td', null, PRICES.fmt(h.price)));
      t.appendChild(tr);
    });
    sec.appendChild(t);
    body.appendChild(sec);
  }

  /* --- Watchlist verwalten --- */
  function bazarWatchlist(body) {
    var sec = U.el('section', 'card');
    sec.appendChild(U.el('div', 'label', 'Watchlist'));
    sec.appendChild(U.el('p', 'sub',
      'Item suchen, gewünschte Boni angeben — sobald so ein Angebot neu im Bazar ' +
      'auftaucht, erscheint es oben unter Treffer (mit Ton, wenn eingeschaltet). ' +
      'Der Abgleich läuft auf dem Rechner mit metin-bazar-pro, also nur solange der läuft.'));

    var list = DB.data.watchlist.slice().sort(function (a, b) {
      return String(a.label).localeCompare(String(b.label));
    });

    if (list.length) {
      var t = U.el('table', 'mini');
      var hr = U.el('tr');
      ['Item', 'geforderte Boni', 'Höchstpreis', 'aktiv', ''].forEach(function (h) {
        hr.appendChild(U.el('th', null, h));
      });
      t.appendChild(hr);

      list.forEach(function (w) {
        var tr = U.el('tr');
        var tdN = U.el('td', null, w.label);
        tdN.title = (w.vnums || []).length + ' vnum(s): ' + (w.vnums || []).join(', ');
        tr.appendChild(tdN);

        var attrs = w.required_attrs || [];
        tr.appendChild(U.el('td', 'dim', attrs.length
          ? attrs.map(function (a) { return STATS.label(a.statId) + ' ≥ ' + a.minValue; }).join(' · ')
          : 'egal'));

        var tdP = U.el('td');
        var inP = U.el('input', 'txt small');
        inP.value = Number(w.max_price) ? PRICES.fmtShort(w.max_price) : '';
        inP.placeholder = 'egal';
        inP.title = 'Höchstpreis pro Stück — "3,5 Won", "20 Mio", leer = egal';
        inP.onchange = function () {
          w.max_price = PRICES.parseYang(inP.value);
          DB.saveWatch(w); renderBazar();
        };
        tdP.appendChild(inP); tr.appendChild(tdP);

        var tdE = U.el('td');
        var cb = U.el('input');
        cb.type = 'checkbox'; cb.checked = w.enabled !== false;
        cb.onchange = function () { w.enabled = cb.checked; DB.saveWatch(w); renderBazar(); };
        tdE.appendChild(cb); tr.appendChild(tdE);

        var tdX = U.el('td');
        var del = U.el('button', 'btn tiny danger', '×');
        del.title = 'Eintrag samt Treffern löschen';
        del.onclick = function () { DB.deleteWatch(w.id); renderBazar(); };
        tdX.appendChild(del); tr.appendChild(tdX);

        t.appendChild(tr);
      });
      sec.appendChild(t);
    } else {
      sec.appendChild(U.el('p', 'side-empty', 'noch nichts auf der Liste'));
    }

    var add = U.el('button', 'btn', '+ Eintrag');
    add.onclick = openWatchDlg;
    sec.appendChild(add);

    if (!DB.data.market_items.length) {
      sec.appendChild(U.el('p', 'sub',
        'Der Item-Katalog fehlt noch — er kommt mit dem nächsten Push vom Rechner.'));
    }
    body.appendChild(sec);
  }

  /* --- Eintrag anlegen --- */
  var wdItem = null;      // gewaehltes Item { vnum, name }
  var wdAttrs = [];       // [{ statId, minValue }]

  function openWatchDlg() {
    wdItem = null;
    wdAttrs = [];
    $('wdSearch').value = '';
    $('wdPrice').value = '';
    paintWatchDlg();
    $('watchDlg').hidden = false;
    $('wdSearch').focus();
  }

  function paintWatchDlg() {
    // Suchergebnisse
    var res = $('wdResults');
    res.innerHTML = '';
    var q = $('wdSearch').value;
    if (!wdItem) {
      var hits = PRICES.searchItems(q, 20);
      if (q.trim().length < 2) {
        res.appendChild(U.el('p', 'side-empty', 'mindestens zwei Buchstaben'));
      } else if (!hits.length) {
        res.appendChild(U.el('p', 'side-empty', 'nichts gefunden — liegt gerade nichts davon im Bazar?'));
      }
      hits.forEach(function (i) {
        var b = U.el('button', 'wdhit');
        b.appendChild(U.el('span', null, i.name));
        b.appendChild(U.el('span', 'dim', i.listings + '× · ab ' + PRICES.fmtShort(i.cheapest)));
        b.onclick = function () { wdItem = i; paintWatchDlg(); };
        res.appendChild(b);
      });
    } else {
      var pick = U.el('div', 'wdpick');
      pick.appendChild(U.el('b', null, wdItem.name));
      var chg = U.el('button', 'btn tiny', 'ändern');
      chg.onclick = function () { wdItem = null; paintWatchDlg(); };
      pick.appendChild(chg);
      res.appendChild(pick);
    }

    // Bonuszeilen
    var box = $('wdAttrs');
    box.innerHTML = '';
    wdAttrs.forEach(function (a, idx) {
      var row = U.el('div', 'row');
      var sel = U.el('select', 'txt small');
      STATS.list.forEach(function (s) {
        var o = U.el('option', null, STATS.label(s.id));
        o.value = String(s.id);
        if (s.id === a.statId) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { a.statId = Number(sel.value); };
      row.appendChild(sel);

      row.appendChild(U.el('span', 'sub', '≥'));
      var val = U.el('input', 'txt small');
      val.type = 'number'; val.value = String(a.minValue);
      val.onchange = function () { a.minValue = Number(val.value) || 0; };
      row.appendChild(val);

      var del = U.el('button', 'btn tiny danger', '×');
      del.onclick = function () { wdAttrs.splice(idx, 1); paintWatchDlg(); };
      row.appendChild(del);
      box.appendChild(row);
    });

    $('wdSave').disabled = !wdItem;
  }

  /* --- Ton bei neuen Treffern --- */
  var lastHitCount = null;

  function checkHitAlarm() {
    var n = PRICES.unseenCount();
    if (lastHitCount === null) { lastHitCount = n; return; }   // beim Start nicht laeuten
    if (n > lastHitCount) {
      var newest = PRICES.hits(true)[0];
      ALARM.fire('_default',
        'Watchlist-Treffer',
        newest ? newest.name + ' von ' + newest.seller + ' — ' + PRICES.fmt(newest.price)
               : (n - lastHitCount) + ' neue Treffer');
    }
    lastHitCount = n;
  }

  /* --- Was lohnt sich: Runs nach Stundenwert --- */
  function bazarRuns(body) {
    var rank = PRICES.ranking();
    if (!rank.length) return;

    var sec = U.el('section', 'card');
    sec.appendChild(U.el('div', 'label', 'Was lohnt sich'));
    sec.appendChild(U.el('p', 'sub',
      'Wert pro Run aus den Truhen, geteilt durch die Laufzeit — oder durch den ' +
      'Cooldown, solange keine Laufzeit eingetragen ist (Einstellungen → Runs).'));

    var t = U.el('table', 'mini');
    var hr = U.el('tr');
    ['Run', 'Wert/Run', 'pro Stunde', 'Grundlage', ''].forEach(function (h) {
      hr.appendChild(U.el('th', null, h));
    });
    t.appendChild(hr);

    rank.forEach(function (v) {
      var tr = U.el('tr');
      var tdN = U.el('td');
      var dot = U.el('span', 'run-dot');
      dot.style.background = v.color || '#888';
      tdN.appendChild(dot);
      tdN.appendChild(U.el('span', null, ' ' + v.label));
      tr.appendChild(tdN);

      tr.appendChild(U.el('td', v.perRun < 0 ? 'bad' : '', PRICES.fmt(v.perRun)));

      var lead = v.perHourActive === null ? v.perHour : v.perHourActive;
      var tdH = U.el('td');
      tdH.appendChild(U.el('b', v.perRun < 0 ? 'bad' : 'good', PRICES.fmt(lead)));
      tr.appendChild(tdH);

      tr.appendChild(U.el('td', 'dim', v.perHourActive === null
        ? 'Cooldown ' + U.fmtDur(v.seconds)
        : 'Laufzeit ' + U.fmtDur(v.runSeconds)));

      var tdB = U.el('td');
      var b = U.el('button', 'btn tiny', 'aufschlüsseln');
      b.onclick = function () { openValueDlg(v.runKey); };
      tdB.appendChild(b);
      tr.appendChild(tdB);

      t.appendChild(tr);
    });
    sec.appendChild(t);
    body.appendChild(sec);
  }

  /* --- Truhen: Marktpreis gegen Erwartungswert --- */
  function bazarChests(body) {
    var chests = (DB.data.chest_values || []).slice();
    if (!chests.length) return;

    var rows = chests.map(function (c) {
      var ev = PRICES.chestEV(c);
      var market = Number(c.chest_price) || 0;
      return { c: c, ev: ev, market: market, diff: market ? ev - market : 0 };
    }).sort(function (a, b) { return b.ev - a.ev; });

    var sec = U.el('section', 'card');
    sec.appendChild(U.el('div', 'label', 'Truhen'));
    sec.appendChild(U.el('p', 'sub',
      'Erwartungswert einer Öffnung gegen den Marktpreis. Öffnen lohnt sich nur, ' +
      'wenn die Truhe billiger ist, als drin steckt.'));

    var t = U.el('table', 'mini');
    var hr = U.el('tr');
    ['Truhe', 'Marktpreis', 'Erwartungswert', 'Differenz', 'Marge', 'Fazit'].forEach(function (h) {
      hr.appendChild(U.el('th', null, h));
    });
    t.appendChild(hr);

    rows.forEach(function (r) {
      var tr = U.el('tr');
      tr.appendChild(U.el('td', null, r.c.name));
      tr.appendChild(U.el('td', r.market ? '' : 'dim', r.market ? PRICES.fmt(r.market) : 'kein Angebot'));
      tr.appendChild(U.el('td', null, PRICES.fmt(r.ev)));
      if (r.market) {
        tr.appendChild(U.el('td', r.diff > 0 ? 'good' : 'bad',
                            (r.diff > 0 ? '+' : '') + PRICES.fmt(r.diff)));
        tr.appendChild(U.el('td', r.diff > 0 ? 'good' : 'bad',
                            (r.diff > 0 ? '+' : '') + (r.diff / r.market * 100).toFixed(0) + ' %'));
        tr.appendChild(U.el('td', r.diff > 0 ? 'good' : 'bad', r.diff > 0 ? 'öffnen' : 'verkaufen'));
      } else {
        tr.appendChild(U.el('td', 'dim', '—'));
        tr.appendChild(U.el('td', 'dim', '—'));
        tr.appendChild(U.el('td', 'dim', '—'));
      }
      t.appendChild(tr);
    });
    sec.appendChild(t);
    body.appendChild(sec);
  }

  /* --- Alchemie: lohnt der Aufstieg? --- */
  function bazarAlchemy(body) {
    var stones = PRICES.stones();
    if (!stones.length) return;

    var sec = U.el('section', 'card');
    sec.appendChild(U.el('div', 'label', 'Alchemie'));
    sec.appendChild(U.el('p', 'sub',
      'Ein Aufstieg gelingt zu 50 %, im Fehlschlag kommt ein Stein zurück — ' +
      'im Schnitt kostet eine Stufe also drei Steine. Bei den Mythisch-Stufen ' +
      'sind es 70 % (≈ 1,43). Grün heißt: die nächste Stufe ist mehr wert als ' +
      'das, was man hineinsteckt.'));

    var best = PRICES.bestUpgrade();
    if (best) {
      var hint = U.el('p', 'sub good');
      hint.textContent = 'Bestes Geschäft gerade: ' + best.stone + ' ' +
        best.step.from.name + ' → ' + best.step.to.name +
        ' (+' + best.percent.toFixed(0) + ' %, ' + PRICES.fmt(best.step.profit) + ' je Stein)';
      sec.appendChild(hint);
    }

    stones.forEach(function (s) {
      var t = U.el('table', 'mini');
      var hr = U.el('tr');
      [s.name, 'Preis', 'Aufstieg kostet', 'Gewinn', ''].forEach(function (h) {
        hr.appendChild(U.el('th', null, h));
      });
      t.appendChild(hr);

      s.rows.forEach(function (row, i) {
        var st = s.steps[i];
        var tr = U.el('tr');
        tr.appendChild(U.el('td', null, row.name));

        var price = PRICES.override(row.vnum) !== null ? PRICES.override(row.vnum) : Number(row.price) || 0;
        tr.appendChild(U.el('td', price ? '' : 'dim', price ? PRICES.fmt(price) : 'kein Angebot'));

        if (st && st.known) {
          tr.appendChild(U.el('td', 'dim',
            PRICES.fmt(st.cost) + '  (' + st.factor.toFixed(2).replace('.', ',') + '×)'));
          tr.appendChild(U.el('td', st.profit > 0 ? 'good' : 'bad',
            (st.profit > 0 ? '+' : '') + PRICES.fmt(st.profit)));
          tr.appendChild(U.el('td', st.profit > 0 ? 'good' : 'bad',
            (st.profit > 0 ? '+' : '') + st.percent.toFixed(0) + ' %'));
        } else {
          tr.appendChild(U.el('td', 'dim', st ? '—' : ''));
          tr.appendChild(U.el('td', 'dim', ''));
          tr.appendChild(U.el('td', 'dim', ''));
        }
        t.appendChild(tr);
      });
      sec.appendChild(t);
    });

    body.appendChild(sec);
  }

  function switchView(view) {
    prefs.view = view === 'bazar' ? 'bazar' : 'runs';
    savePrefs();
    $('viewRuns').hidden = prefs.view !== 'runs';
    $('toolbarRuns').hidden = prefs.view !== 'runs';
    $('viewBazar').hidden = prefs.view !== 'bazar';
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
      b.classList.toggle('on', b.dataset.view === prefs.view);
    });
    if (prefs.view === 'bazar') renderBazar();
  }

  /* Ungelesene Watchlist-Treffer als Zahl am Reiter — sonst sieht man sie
     nur, wenn man zufaellig im Bazar steht. */
  function paintTabBadge() {
    var n = PRICES.unseenCount();
    var tab = document.querySelector('#tabs .tab[data-view="bazar"]');
    if (!tab) return;
    var b = tab.querySelector('.badge');
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = U.el('span', 'badge'); tab.appendChild(b); }
    b.textContent = String(n);
    b.title = n + ' neue Treffer aus der Watchlist';
  }

  /* --------------------------------------------------- Beute bearbeiten */

  /* ------------------------------------------------ Wert aufschluesseln */

  /* Zeigt, wie der Wert eines Runs zustande kommt: erst die Truhen pro Run
     (Menge aenderbar), dann je Truhe jeder Drop mit Rate, Stueckpreis und
     Beitrag. Jeder Stueckpreis ist ueberschreibbar — noetig fuer alles, was
     nicht handelbar ist (Segenskugel, Blutstein) und damit nie einen
     Marktpreis hat. Die Aenderung gilt fuer alle und wirkt sofort, ohne auf
     den naechsten Push zu warten. */
  function openValueDlg(runKey) {
    var val = PRICES.valueFor(runKey);
    if (!val) return;

    $('vdTitle').textContent = val.label + ' — ' + PRICES.fmt(val.perRun) + ' pro Run';
    var body = $('vdBody');
    body.innerHTML = '';

    var head = U.el('section', 'card');
    head.appendChild(U.el('div', 'label', 'Pro Run'));
    var sum = U.el('p', 'sub');
    sum.textContent = val.perHourActive !== null
      ? PRICES.fmt(val.perHourActive) + '/h bei ' + U.fmtDur(val.runSeconds) + ' Laufzeit · ' +
        PRICES.fmt(val.perHour) + '/h über den Cooldown (' + U.fmtDur(val.seconds) + ')'
      : PRICES.fmt(val.perHour) + '/h über den Cooldown (' + U.fmtDur(val.seconds) +
        ') · Laufzeit nicht eingetragen';
    head.appendChild(sum);

    var t = U.el('table', 'mini');
    var hr = U.el('tr');
    ['Truhe / Position', 'Ø pro Run', 'Wert je Stück', 'Beitrag'].forEach(function (h) {
      hr.appendChild(U.el('th', null, h));
    });
    t.appendChild(hr);

    val.parts.forEach(function (p) {
      var tr = U.el('tr');
      tr.appendChild(U.el('td', null, (p.isCost ? '− ' : '') + p.name));

      var tdQ = U.el('td');
      if (p.fixed) {
        tdQ.className = 'dim';
        tdQ.textContent = 'Pauschale';
      } else {
        var inQ = U.el('input', 'txt small');
        inQ.value = String(p.qty).replace('.', ',');
        inQ.onchange = function () {
          var n = parseFloat(String(inQ.value).replace(',', '.'));
          if (!isFinite(n) || n < 0) { inQ.value = String(p.qty).replace('.', ','); return; }
          var row = DB.lootFor(runKey).find(function (l) {
            return Number(l.vnum) === Number(p.vnum) && l.kind === p.kind;
          });
          if (!row) return;
          row.qty = n; DB.saveRunLoot(row);
          openValueDlg(runKey); render();
        };
        tdQ.appendChild(inQ);
      }
      tr.appendChild(tdQ);

      tr.appendChild(U.el('td', 'dim', p.known ? PRICES.fmt(p.unit) : '—'));
      tr.appendChild(U.el('td', null, PRICES.fmt(p.isCost ? -p.value : p.value)));
      t.appendChild(tr);
    });
    head.appendChild(t);
    body.appendChild(head);

    // Je Truhe die volle Aufschluesselung.
    val.parts.forEach(function (p) {
      if (p.kind !== 'chest') return;
      var c = DB.data.chest_values.find(function (x) { return Number(x.vnum) === Number(p.vnum); });
      if (!c) return;
      var rows = PRICES.chestBreakdown(c);
      if (!rows.length) return;

      var sec = U.el('section', 'card');
      var lab = U.el('div', 'label', p.name);
      if ((Number(c.openings) || 1) > 1) {
        lab.appendChild(U.el('span', 'dim', '  ' + c.openings + ' Drops pro Öffnung'));
      }
      sec.appendChild(lab);

      // Markt gegen Erwartungswert: die Frage ist ja nicht nur "was ist drin",
      // sondern "aufmachen oder so verkaufen".
      var ev = PRICES.chestEV(c);
      var market = Number(c.chest_price) || 0;
      var cmp = U.el('div', 'cmp');
      function stat(label, text, cls) {
        var d = U.el('div', 'cmp-box');
        d.appendChild(U.el('span', 'cmp-l', label));
        d.appendChild(U.el('b', 'cmp-v' + (cls ? ' ' + cls : ''), text));
        return d;
      }
      cmp.appendChild(stat('Marktpreis', market ? PRICES.fmt(market) : 'kein Angebot'));
      cmp.appendChild(stat('Erwartungswert', PRICES.fmt(ev)));
      if (market) {
        var diff = ev - market;
        cmp.appendChild(stat('Differenz', (diff > 0 ? '+' : '') + PRICES.fmt(diff),
                             diff > 0 ? 'good' : 'bad'));
        cmp.appendChild(stat('Marge',
          (diff > 0 ? '+' : '') + (diff / market * 100).toFixed(0) + ' %',
          diff > 0 ? 'good' : 'bad'));
        cmp.appendChild(stat('Fazit', diff > 0 ? 'öffnen' : 'verkaufen',
                             diff > 0 ? 'good' : 'bad'));
      }
      sec.appendChild(cmp);

      var noPrice = rows.filter(function (r) { return !r.unit && !r.ignored; }).length;
      var skipped = rows.filter(function (r) { return r.ignored; }).length;
      var merged = rows.reduce(function (s, r) { return s + (r.rows > 1 ? r.rows - 1 : 0); }, 0);
      sec.appendChild(U.el('p', 'sub',
        rows.length + ' mögliche Drops' +
        (merged ? ' (' + (rows.length + merged) + ' Einträge — gleiche Items zusammengefasst)' : '') +
        (noPrice ? ' · ' + noPrice + ' ohne Preis (zählen mit 0 — hier eintragen, wenn du es besser weißt)' : '') +
        (skipped ? ' · ' + skipped + ' abgewählt' : '')));

      var dt = U.el('table', 'mini drops');
      var dh = U.el('tr');
      ['Drop', 'Rate', 'Stück', 'Wert je Stück', 'Beitrag', 'zählt'].forEach(function (h) {
        dh.appendChild(U.el('th', null, h));
      });
      dt.appendChild(dh);

      rows.forEach(function (d) {
        var tr = U.el('tr', (d.ignored ? 'skip' : (d.unit ? '' : 'nop')));
        var tdN = U.el('td', null, d.name);
        if (d.untradeable) tdN.title = 'nicht handelbar — hat nie einen Marktpreis';
        tr.appendChild(tdN);

        var tdR = U.el('td', 'dim', d.rate.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' %');
        if (d.rows > 1) {
          tdR.textContent += ' *';
          tdR.title = d.rows + ' Einträge in der Droptabelle, hier zusammengefasst';
        }
        tr.appendChild(tdR);
        tr.appendChild(U.el('td', 'dim', d.qty > 1 ? d.qty + '×' : ''));

        var tdU = U.el('td');
        var inU = U.el('input', 'txt small' + (d.manual ? ' manual' : ''));
        inU.value = d.unit ? PRICES.fmtShort(d.unit) : '';
        inU.placeholder = d.untradeable ? 'nicht handelbar' : '—';
        inU.title = d.manual
          ? 'von Hand gesetzt — leeren, um wieder den Marktpreis zu nehmen'
          : 'eigenen Wert setzen ("3,5 Won", "20 Mio")';
        inU.onchange = function () {
          var n = PRICES.parseYang(inU.value);
          DB.setPriceOverride(d.vnum, n, d.name, ZGATE.user());
          openValueDlg(runKey); render();
        };
        tdU.appendChild(inU); tr.appendChild(tdU);

        tr.appendChild(U.el('td', null, d.ignored ? 'zählt nicht' : (d.ev ? PRICES.fmt(d.ev) : '—')));

        // Haken raus = der Drop faellt aus der Rechnung. Fuer alles, was man
        // ohnehin liegen laesst; ein gesetzter Preis bleibt dabei erhalten.
        var tdI = U.el('td');
        var cbI = U.el('input');
        cbI.type = 'checkbox';
        cbI.checked = !d.ignored;
        cbI.title = 'Haken raus: dieser Drop wird nicht mitgezählt';
        cbI.onchange = function () {
          DB.setPriceIgnored(d.vnum, !cbI.checked, d.name, ZGATE.user());
          openValueDlg(runKey); render();
        };
        tdI.appendChild(cbI); tr.appendChild(tdI);

        dt.appendChild(tr);
      });
      sec.appendChild(dt);
      body.appendChild(sec);
    });

    $('valueDlg').hidden = false;
  }

  /* --------------------------------------------------- Beute bearbeiten */

  function renderLootTable() {
    var tbl = $('lootTable');
    tbl.innerHTML = '';
    var head = U.el('tr');
    ['Run', 'Truhe / Item', 'Ø pro Run', 'Wert', 'Kosten', ''].forEach(function (h) {
      head.appendChild(U.el('th', null, h));
    });
    tbl.appendChild(head);

    var runs = {};
    DB.data.run_types.forEach(function (r) { runs[r.key] = r.label; });

    DB.data.run_loot.slice()
      .sort(function (a, b) {
        return String(a.run_key).localeCompare(String(b.run_key)) || (a.sort || 0) - (b.sort || 0);
      })
      .forEach(function (l) {
        var tr = U.el('tr');
        tr.appendChild(U.el('td', null, runs[l.run_key] || l.run_key));
        tr.appendChild(U.el('td', null, l.name || ('vnum ' + l.vnum)));

        var fixed = l.kind === 'fixed';

        var tdQ = U.el('td');
        var inQ = U.el('input', 'txt small');
        // Bei einer Pauschale IST die Menge der Wert — dann auch so anzeigen
        // und "3,5 Won" beim Tippen verstehen.
        inQ.value = fixed ? PRICES.fmtShort(l.qty) : String(l.qty).replace('.', ',');
        inQ.title = fixed ? 'Wert pro Run — "3,5 Won", "20 Mio" oder die nackte Zahl' : '';
        inQ.onchange = function () {
          var n = fixed ? PRICES.parseYang(inQ.value)
                        : parseFloat(String(inQ.value).replace(',', '.'));
          if (!isFinite(n) || n <= 0) {
            inQ.value = fixed ? PRICES.fmtShort(l.qty) : String(l.qty).replace('.', ',');
            return;
          }
          l.qty = n; DB.saveRunLoot(l);
          renderLootTable(); render();
        };
        tdQ.appendChild(inQ); tr.appendChild(tdQ);

        // Was diese eine Position beisteuert — sonst raet man beim Eintragen.
        var src = fixed ? null : (l.kind === 'item'
          ? DB.data.item_prices.find(function (p) { return Number(p.vnum) === Number(l.vnum); })
          : DB.data.chest_values.find(function (p) { return Number(p.vnum) === Number(l.vnum); }));
        var total = fixed ? Number(l.qty)
                          : (src ? Number(l.kind === 'item' ? src.price : src.expected_value) * Number(l.qty) : 0);
        tr.appendChild(U.el('td', 'dim', total ? PRICES.fmtShort(total) : '—'));

        var tdC = U.el('td');
        var cb = U.el('input');
        cb.type = 'checkbox'; cb.checked = !!l.is_cost;
        cb.title = 'wird abgezogen statt addiert (Schlüssel, Eintritt, Verbrauch)';
        cb.onchange = function () { l.is_cost = cb.checked; DB.saveRunLoot(l); renderLootTable(); render(); };
        tdC.appendChild(cb); tr.appendChild(tdC);

        var tdX = U.el('td');
        var del = U.el('button', 'btn tiny danger', '×');
        del.onclick = function () {
          DB.deleteRunLoot(l.id);
          renderLootTable(); render();
        };
        tdX.appendChild(del); tr.appendChild(tdX);

        tbl.appendChild(tr);
      });

    // Auswahlfelder fuellen
    var selR = $('newLootRun');
    selR.innerHTML = '';
    DB.runTypes().forEach(function (r) {
      var o = U.el('option', null, r.label); o.value = r.key; selR.appendChild(o);
    });

    var selC = $('newLootChest');
    selC.innerHTML = '';
    // Pauschale zuerst: fuer Runs, deren Ertrag nicht aus einer handelbaren
    // Truhe kommt (Meley) — dann ist die "Menge" der Wert.
    var oFix = U.el('option', null, 'Pauschale (Wert eintragen)');
    oFix.value = 'fixed:0:Pauschale';
    selC.appendChild(oFix);
    DB.data.chest_values.slice()
      .sort(function (a, b) { return Number(b.expected_value) - Number(a.expected_value); })
      .forEach(function (c) {
        var o = U.el('option', null, c.name + ' — ' + PRICES.fmtShort(c.expected_value));
        o.value = 'chest:' + c.vnum + ':' + c.name;
        selC.appendChild(o);
      });

    $('lootHint').textContent = DB.data.chest_values.length
      ? DB.data.chest_values.length + ' Truhen mit Erwartungswert verfügbar'
      : 'Noch keine Truhenpreise da — der Push-Job auf Dominiks PC füllt sie.';
  }

  function renderRunTable() {
    var tbl = $('runTable');
    tbl.innerHTML = '';
    var head = U.el('tr');
    ['Run', 'Cooldown', 'Laufzeit', 'ab Start', 'Regi', 'Farbe', ''].forEach(function (h) {
      head.appendChild(U.el('th', null, h));
    });
    tbl.appendChild(head);

    DB.data.run_types.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); })
      .forEach(function (r) {
        var tr = U.el('tr');

        var tdL = U.el('td');
        var inL = U.el('input', 'txt small');
        inL.value = r.label;
        inL.onchange = function () { r.label = inL.value.trim() || r.key; DB.saveRunType(r); render(); };
        tdL.appendChild(inL); tr.appendChild(tdL);

        var tdD = U.el('td');
        var inD = U.el('input', 'txt small');
        inD.value = U.fmtDur(r.seconds);
        inD.onchange = function () {
          var s = U.parseDur(inD.value);
          if (!s) { inD.value = U.fmtDur(r.seconds); return; }
          r.seconds = s; DB.saveRunType(r); inD.value = U.fmtDur(s); render();
        };
        tdD.appendChild(inD); tr.appendChild(tdD);

        // Wie lange der Run tatsaechlich dauert. Daraus kommt der ehrliche
        // Stundenwert: wer genug Charaktere hat, wartet nie auf den Cooldown.
        var tdA = U.el('td');
        var inA = U.el('input', 'txt small');
        inA.value = r.run_seconds ? U.fmtDur(r.run_seconds) : '';
        inA.placeholder = 'z. B. 12m';
        inA.title = 'Wie lange du für den Run brauchst — daraus rechnet die Seite Yang/h';
        inA.onchange = function () {
          var s = U.parseDur(inA.value);
          r.run_seconds = s;                      // leer bzw. Unsinn = 0 = nicht gesetzt
          DB.saveRunType(r);
          inA.value = s ? U.fmtDur(s) : '';
          render();
        };
        tdA.appendChild(inA); tr.appendChild(tdA);

        var tdS = U.el('td');
        var cb = U.el('input');
        cb.type = 'checkbox'; cb.checked = !!r.from_start;
        cb.title = 'Cooldown läuft ab dem Betreten statt ab dem Abschluss';
        cb.onchange = function () { r.from_start = cb.checked; DB.saveRunType(r); render(); };
        tdS.appendChild(cb); tr.appendChild(tdS);

        var tdR = U.el('td');
        var rg = U.el('input');
        rg.type = 'checkbox'; rg.checked = !!r.has_registration;
        rg.title = 'Run hat eine Anmeldung (Meley) — zeigt den Regi-Knopf';
        rg.onchange = function () { r.has_registration = rg.checked; DB.saveRunType(r); render(); };
        tdR.appendChild(rg); tr.appendChild(tdR);

        var tdC = U.el('td');
        var col = U.el('input');
        col.type = 'color'; col.value = r.color || '#3aaac1';
        col.onchange = function () { r.color = col.value; DB.saveRunType(r); render(); };
        tdC.appendChild(col); tr.appendChild(tdC);

        var tdX = U.el('td');
        var del = U.el('button', 'btn tiny danger', '×');
        del.title = 'Run entfernen (Timer dazu bleiben stehen)';
        del.onclick = function () {
          if (!confirm('"' + r.label + '" für alle entfernen?')) return;
          DB.deleteRunType(r.key); renderRunTable(); render();
        };
        tdX.appendChild(del); tr.appendChild(tdX);

        tbl.appendChild(tr);
      });
  }

  function renderSoundRows() {
    var wrap = $('soundRows');
    wrap.innerHTML = '';
    var entries = [{ key: '_default', label: 'Standard (alle Runs ohne eigenen Ton)' }]
      .concat(DB.runTypes().map(function (r) { return { key: r.key, label: r.label }; }))
      .concat([{ key: '_spawn', label: 'Channel-Spawn' }]);

    entries.forEach(function (e) {
      var row = U.el('div', 'srow');
      row.appendChild(U.el('span', 'sname', e.label));

      var have = U.el('span', 'sub', ALARM.sounds[e.key] ? 'eigener Ton' : 'Standardton');
      row.appendChild(have);

      var file = U.el('input');
      file.type = 'file'; file.accept = 'audio/*';
      file.onchange = function () {
        ALARM.setSoundFile(e.key, file.files[0]).then(function (err) {
          have.textContent = err || (ALARM.sounds[e.key] ? 'eigener Ton' : 'Standardton');
          have.className = err ? 'sub bad' : 'sub';
        });
      };
      row.appendChild(file);

      var test = U.el('button', 'btn tiny', '▶');
      test.title = 'anhören';
      test.onclick = function () { ALARM.play(e.key); };
      row.appendChild(test);

      var clr = U.el('button', 'btn tiny', '×');
      clr.title = 'auf Standardton zurücksetzen';
      clr.onclick = function () { ALARM.clearSound(e.key); have.textContent = 'Standardton'; };
      row.appendChild(clr);

      wrap.appendChild(row);
    });
  }

  function openSettings() {
    $('sbUrl').value = DB.creds.url || '';
    $('sbKey').value = DB.creds.key || '';
    $('connMsg').textContent = DB.status.text;
    $('optSound').checked = ALARM.opts.sound;
    $('optNotify').checked = ALARM.opts.notify;
    $('optSpawn').checked = ALARM.opts.spawn;
    $('optLead').value = ALARM.opts.lead;
    $('optVolume').value = Math.round(ALARM.opts.volume * 100);
    paintNotifyState();
    renderLootTable();
    renderRunTable();
    renderSoundRows();
    $('settings').hidden = false;
  }

  function paintNotifyState() {
    var s = ALARM.notifyState();
    $('notifyState').textContent =
      s === 'granted' ? 'Benachrichtigungen sind erlaubt.' :
      s === 'denied' ? 'Der Browser blockt Benachrichtigungen für diese Seite — im Schloss-Symbol der Adressleiste wieder erlauben.' :
      s === 'not-supported' ? 'Dieser Browser kann keine Benachrichtigungen.' :
      'Beim Einschalten fragt der Browser einmal nach Erlaubnis.';
  }

  /* ================================================================ Boot */

  function wire() {
    $('filter').value = prefs.filter;
    $('filter').oninput = function () { prefs.filter = this.value; savePrefs(); render(); };
    $('onlyMine').checked = prefs.onlyMine;
    $('onlyMine').onchange = function () { prefs.onlyMine = this.checked; savePrefs(); render(); };
    paintGroupBy();
    $('groupBy').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-group]');
      if (!b) return;
      prefs.groupBy = b.dataset.group;
      savePrefs(); paintGroupBy(); render();
    });

    /* Notiz: beim Verlassen des Feldes bzw. mit Enter speichern — nicht bei
       jedem Tastendruck, sonst schreibt man den anderen die Zeile zu. */
    $('gridBody').addEventListener('change', function (ev) {
      var inp = ev.target.closest('input[data-note]');
      if (!inp) return;
      DB.setNote(inp.dataset.note, inp.value.trim());
    });

    $('btnAddChar').onclick = function () { openCharDialog(null); };
    $('btnWho').onclick = function () { ZGATE.ask(); };
    ZGATE.onUser(function () { paintWho(); render(); });

    $('btnSettings').onclick = openSettings;
    $('btnCloseSettings').onclick = function () { $('settings').hidden = true; };
    $('btnSound').onclick = function () {
      ALARM.opts.sound = !ALARM.opts.sound; ALARM.saveOpts(); paintSoundBtn();
    };

    /* Ein Klick in der Tabelle: fertig-Knopf oder laufender Timer. */
    $('gridBody').addEventListener('click', function (ev) {
      var out = ev.target.closest('button[data-logout]');
      if (out) return doLogout(out.dataset.logout);
      var log = ev.target.closest('button[data-login]');
      if (log) return doLogin(log.dataset.login);
      var edit = ev.target.closest('button[data-edit]');
      if (edit) return openCharDialog(edit.dataset.edit);
      var btn = ev.target.closest('button[data-char]');
      if (!btn) return;
      if (btn.dataset.regi) {
        var had = btn.classList.contains('set');
        DB.setRegistration(btn.dataset.char, btn.dataset.run, had ? null : Date.now(), ZGATE.user());
        render();
        return;
      }
      if (btn.classList.contains('running')) openTimerDialog(btn.dataset.char, btn.dataset.run);
      else startTimer(btn.dataset.char, btn.dataset.run);
    });

    /* --- Timer-Dialog --- */
    $('tdClose').onclick = function () { $('timerDlg').hidden = true; };
    $('tdSet').onclick = function () {
      var sec = U.parseDur($('tdRemain').value);
      if (!sec || !dlgTimer) return;
      var now = Date.now();
      DB.setTimer(dlgTimer.charId, dlgTimer.runKey, now, now + sec * 1000, ZGATE.user());
      $('timerDlg').hidden = true; render();
    };
    $('tdRegiSet').onclick = function () {
      if (!dlgTimer) return;
      var t = DB.timerFor(dlgTimer.charId, dlgTimer.runKey);
      DB.setRegistration(dlgTimer.charId, dlgTimer.runKey,
        (t && t.registered_at) ? null : Date.now(), ZGATE.user());
      openTimerDialog(dlgTimer.charId, dlgTimer.runKey);   // Anzeige auffrischen
      render();
    };
    $('tdRestart').onclick = function () {
      if (!dlgTimer) return;
      startTimer(dlgTimer.charId, dlgTimer.runKey);
      $('timerDlg').hidden = true;
    };
    $('tdClear').onclick = function () {
      if (!dlgTimer) return;
      DB.clearTimer(dlgTimer.charId, dlgTimer.runKey);
      $('timerDlg').hidden = true; render();
    };

    /* --- Reiter --- */
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
      b.onclick = function () { switchView(b.dataset.view); };
    });

    /* --- Watchlist-Dialog --- */
    $('wdClose').onclick = function () { $('watchDlg').hidden = true; };
    $('wdSearch').oninput = function () { if (!wdItem) paintWatchDlg(); };
    $('wdAddAttr').onclick = function () {
      // Angriffswert ist der haeufigste Wunsch — als Vorgabe brauchbar.
      wdAttrs.push({ statId: 53, minValue: 0 });
      paintWatchDlg();
    };
    $('wdSave').onclick = function () {
      if (!wdItem) return;
      DB.saveWatch({
        id: U.uuid(),
        label: wdItem.name,
        // Nur dieses eine vnum: gleiche Namen mit anderer Schmiedestufe sind
        // andere Items, und genau die will man meist NICHT mitgemeldet haben.
        vnums: [Number(wdItem.vnum)],
        required_attrs: wdAttrs.filter(function (a) { return a.statId; }),
        max_price: PRICES.parseYang($('wdPrice').value),
        enabled: true,
        by_user: ZGATE.user() || '',
        note: ''
      });
      $('watchDlg').hidden = true;
      renderBazar();
    };

    /* --- Wert-Dialog --- */
    $('vdClose').onclick = function () { $('valueDlg').hidden = true; };

    /* --- Char-Dialog --- */
    $('cdClose').onclick = function () { $('charDlg').hidden = true; };
    $('cdSave').onclick = function () {
      if (!dlgChar) return;
      var name = $('cdName').value.trim();
      if (!name) { $('cdName').focus(); return; }
      dlgChar.name = name;
      dlgChar.server = dlgChar.server || CH.SERVER;
      dlgChar.owner = $('cdOwner').value.trim();
      dlgChar.account = $('cdAccount').value.trim();
      dlgChar.note = $('cdNote').value.trim();
      DB.saveChar(dlgChar);
      $('charDlg').hidden = true;
      render();
    };
    $('cdDelete').onclick = function () {
      if (!dlgChar) return;
      if (!confirm('"' + dlgChar.name + '" mit allen Timern löschen? Das gilt für alle.')) return;
      DB.deleteChar(dlgChar.id);
      $('charDlg').hidden = true;
      render();
    };

    /* --- Einstellungen --- */
    $('btnConnect').onclick = function () {
      $('connMsg').textContent = 'verbinde…';
      DB.connect($('sbUrl').value, $('sbKey').value).then(function (ok) {
        $('connMsg').textContent = ok ? 'verbunden — Daten geladen.' : DB.status.text;
        render();
      });
    };
    $('optSound').onchange = function () { ALARM.opts.sound = this.checked; ALARM.saveOpts(); paintSoundBtn(); };
    $('optSpawn').onchange = function () { ALARM.opts.spawn = this.checked; ALARM.saveOpts(); };
    $('optLead').onchange = function () { ALARM.opts.lead = Math.max(0, parseInt(this.value, 10) || 0); ALARM.saveOpts(); };
    $('optVolume').oninput = function () { ALARM.opts.volume = (parseInt(this.value, 10) || 0) / 100; ALARM.saveOpts(); };
    $('btnTestSound').onclick = function () { ALARM.play('_default'); };
    $('optNotify').onchange = function () {
      var on = this.checked;
      if (!on) { ALARM.opts.notify = false; ALARM.saveOpts(); return paintNotifyState(); }
      ALARM.askNotify().then(function (state) {
        ALARM.opts.notify = state === 'granted';
        $('optNotify').checked = ALARM.opts.notify;
        ALARM.saveOpts();
        paintNotifyState();
      });
    };
    $('btnAddLoot').onclick = function () {
      var runKey = $('newLootRun').value;
      var pick = String($('newLootChest').value || '').split(':');
      var qty = pick[0] === 'fixed'
        ? PRICES.parseYang($('newLootQty').value)      // Pauschale: die Menge ist der Wert
        : parseFloat(String($('newLootQty').value).replace(',', '.'));
      if (!runKey || pick.length < 3 || !isFinite(qty) || qty <= 0) return;
      DB.saveRunLoot({
        id: U.uuid(), run_key: runKey, vnum: Number(pick[1]),
        name: pick.slice(2).join(':'), kind: pick[0], qty: qty,
        is_cost: false, note: '', sort: (DB.lootFor(runKey).length + 1) * 10,
        by_user: ZGATE.user() || ''
      });
      $('newLootQty').value = '1';
      renderLootTable(); render();
    };

    $('btnAddRun').onclick = function () {
      var label = $('newRunLabel').value.trim();
      var sec = U.parseDur($('newRunDur').value);
      if (!label || !sec) return;
      var key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('run' + Date.now());
      DB.saveRunType({
        key: key, label: label, seconds: sec, from_start: false,
        has_registration: false, color: '#3aaac1',
        sort: (DB.data.run_types.length + 1) * 10, enabled: true
      });
      $('newRunLabel').value = ''; $('newRunDur').value = '';
      renderRunTable(); renderSoundRows(); render();
    };

    $('spawnAdd').onsubmit = function (ev) {
      ev.preventDefault();
      var label = $('spLabel').value.trim();
      var t = CH.parseSpawnTime($('spTime').value);
      if (!label || !t) {
        $('spHint').textContent = !label
          ? 'Bitte eine Beschriftung eintragen.'
          : 'Zeit nicht verstanden — z. B. 39:30, min39:30 oder 39:30 /30m';
        $('spHint').classList.add('bad');
        return;
      }
      $('spHint').classList.remove('bad');
      $('spHint').textContent = 'Minute:Sekunde im Takt · „39:30 /30m" für halbstündlich';
      DB.saveSpawn({
        id: U.uuid(), label: label,
        minute: t.minute, second: t.second, period_sec: t.period_sec,
        sort: DB.data.spawns.length, by_user: ZGATE.user()
      });
      $('spLabel').value = ''; $('spTime').value = '';
      renderSpawns();
    };

    $('spawnList').addEventListener('click', function (ev) {
      var del = ev.target.closest('button[data-del]');
      if (!del) return;
      var sp = DB.data.spawns.find(function (x) { return x.id === del.dataset.del; });
      if (sp && !confirm('"' + sp.label + '" für alle löschen?')) return;
      DB.deleteSpawn(del.dataset.del);
      renderSpawns();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      ['settings', 'timerDlg', 'charDlg'].forEach(function (id) { $(id).hidden = true; });
    });

    /* Klick auf den dunklen Rand schliesst den Dialog. */
    ['settings', 'timerDlg', 'charDlg'].forEach(function (id) {
      $(id).addEventListener('click', function (ev) {
        if (ev.target === this) this.hidden = true;
      });
    });
  }

  function paintGroupBy() {
    [].forEach.call($('groupBy').querySelectorAll('button[data-group]'), function (b) {
      b.classList.toggle('on', b.dataset.group === prefs.groupBy);
    });
  }

  function paintSoundBtn() {
    $('btnSound').textContent = ALARM.opts.sound ? '🔊' : '🔇';
    $('btnSound').classList.toggle('ghost', !ALARM.opts.sound);
  }

  function boot() {
    if (!window.U || !window.DB || !window.CH || !window.ALARM) {
      U.fail('Skripte konnten nicht geladen werden — bitte die Seite neu laden.');
      return;
    }
    if (!window.supabase) {
      U.fail('Die Supabase-Bibliothek wurde nicht geladen (kein Netz?). ' +
             'Die Seite läuft solange nur lokal — Änderungen erreichen niemanden sonst.');
    }
    wire();
    paintVersion();
    paintWho();
    paintSoundBtn();
    DB.onStatus(paintStatus);
    DB.onChange(render);
    DB.init();
    switchView(prefs.view);
    render();
    setInterval(tick, 500);
  }

  try {
    boot();
  } catch (e) {
    console.error(e);
    if (window.U && U.fail) U.fail('Fehler beim Start: ' + e.message);
  }
})();
