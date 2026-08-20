/* Gemeinsame Datenhaltung.
 *
 * Zwei Betriebsarten hinter derselben Schnittstelle:
 *   - verbunden  -> Supabase (Postgres + Realtime; Aenderungen kommen per
 *                   WebSocket bei allen anderen an, kein Polling)
 *   - lokal      -> nur localStorage in diesem Browser
 *
 * Zugangsdaten stehen absichtlich NICHT im Repo: die Seite liegt oeffentlich
 * auf GitHub Pages, der Key ist eine Schreibberechtigung. Er wird einmal in
 * den Einstellungen eingefuegt und liegt dann im localStorage.
 *
 * Countdowns werden nie uebertragen — ein Timer ist `started_at` + `ends_at`,
 * die Restzeit rechnet jeder Browser selbst. Synchronisiert wird nur, WENN
 * jemand etwas aendert.
 */
(function () {
  'use strict';

  var CRED_KEY  = 'm2rt.supabase.v1';
  var CACHE_KEY = 'm2rt.cache.v1';

  /* chest_values / item_prices werden NUR gelesen — sie kommen vom Push-Job
     auf Dominiks PC (metin-bazar-pro). run_loot ist wieder beidseitig. */
  var TABLES = ['chars', 'timers', 'run_types', 'channels', 'spawns',
                'chest_values', 'item_prices', 'run_loot', 'price_overrides', 'alchemy_prices'];

  var DEFAULT_RUN_TYPES = [
    { key: 'hydra',  label: 'Hydra',     seconds: 20 * 60,   from_start: true,  color: '#e0574f', sort: 10, enabled: true },
    { key: 'nemere', label: 'Nemere',    seconds: 4 * 3600,  from_start: false, color: '#6aa9ff', sort: 20, enabled: true },
    { key: 'jotun',  label: 'Jotun',     seconds: 2 * 3600,  from_start: false, color: '#7ad0c8', sort: 30, enabled: true },
    { key: 'meley',  label: 'Meley',     seconds: 3 * 3600,  from_start: false, color: '#c9a227', sort: 40, enabled: true, has_registration: true },
    { key: 'sechs7', label: '6/7 Bonus', seconds: 24 * 3600, from_start: false, color: '#9a7fd1', sort: 50, enabled: true },
    { key: 'bio',    label: 'Bio',       seconds: 24 * 3600, from_start: false, color: '#6fbf6f', sort: 60, enabled: true }
  ];

  var DB = window.DB = {
    connected: false,
    creds: U.store.get(CRED_KEY, { url: '', key: '' }),
    data: { chars: [], timers: [], run_types: DEFAULT_RUN_TYPES.slice(), channels: [], spawns: [],
            chest_values: [], item_prices: [], run_loot: [], price_overrides: [], alchemy_prices: [] },
    status: { state: 'off', text: 'nur lokal' },
    DEFAULT_RUN_TYPES: DEFAULT_RUN_TYPES
  };

  var client = null;
  var listeners = [];
  var statusListeners = [];
  var refetchTimer = null;

  DB.onChange = function (fn) { listeners.push(fn); };
  DB.onStatus = function (fn) { statusListeners.push(fn); };

  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }
  function setStatus(state, text) {
    DB.status = { state: state, text: text };
    statusListeners.forEach(function (fn) { try { fn(DB.status); } catch (e) {} });
  }

  function cache() { U.store.set(CACHE_KEY, DB.data); }

  /* ------------------------------------------------------------ Start */

  DB.init = function () {
    var cached = U.store.get(CACHE_KEY, null);
    if (cached && cached.chars) {
      DB.data = cached;
      if (!DB.data.spawns) DB.data.spawns = [];   // aelterer Zwischenspeicher
      ['chest_values', 'item_prices', 'run_loot', 'price_overrides', 'alchemy_prices'].forEach(function (t) {
        if (!DB.data[t]) DB.data[t] = [];
      });
      if (!DB.data.run_types || !DB.data.run_types.length) {
        DB.data.run_types = DEFAULT_RUN_TYPES.slice();
      }
    }
    emit();
    if (DB.creds.url && DB.creds.key) DB.connect(DB.creds.url, DB.creds.key);
    else setStatus('off', 'nur lokal — Zugang fehlt');
  };

  DB.connect = function (url, key) {
    url = String(url || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    key = String(key || '').trim();
    DB.creds = { url: url, key: key };
    U.store.set(CRED_KEY, DB.creds);

    if (!url || !key) {
      DB.connected = false; client = null;
      setStatus('off', 'nur lokal — Zugang fehlt');
      return Promise.resolve(false);
    }
    if (!window.supabase || !window.supabase.createClient) {
      setStatus('bad', 'Supabase-Bibliothek nicht geladen (offline?)');
      return Promise.resolve(false);
    }

    setStatus('busy', 'verbinde…');
    try {
      client = window.supabase.createClient(url, key, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 20 } }
      });
    } catch (e) {
      setStatus('bad', 'Zugang ungültig: ' + e.message);
      return Promise.resolve(false);
    }

    return DB.refetch(true).then(function (ok) {
      if (!ok) return false;
      DB.connected = true;
      subscribe();
      startSafetyNet();
      setStatus('ok', 'verbunden');
      return true;
    });
  };

  /* ------------------------------------------------------------ Lesen */

  DB.refetch = function (loud) {
    if (!client) return Promise.resolve(false);
    return Promise.all(TABLES.map(function (t) {
      return client.from(t).select('*').then(function (res) { return { t: t, res: res }; });
    })).then(function (all) {
      var bad = all.filter(function (a) { return a.res.error; });
      if (bad.length) {
        var msg = bad[0].res.error.message || 'unbekannter Fehler';
        setStatus('bad', 'Fehler bei "' + bad[0].t + '": ' + msg);
        if (loud) console.error('[db]', bad.map(function (b) { return b.t + ': ' + b.res.error.message; }));
        return false;
      }
      all.forEach(function (a) { DB.data[a.t] = a.res.data || []; });
      if (!DB.data.run_types.length) DB.data.run_types = DEFAULT_RUN_TYPES.slice();
      cache();
      emit();
      return true;
    });
  };

  function subscribe() {
    var ch = client.channel('m2rt');
    TABLES.forEach(function (t) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, function () {
        clearTimeout(refetchTimer);
        refetchTimer = setTimeout(function () { DB.refetch(false); }, 150);
      });
    });
    ch.subscribe(function (state) {
      if (state === 'SUBSCRIBED') setStatus('ok', 'verbunden · live');
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('warn', 'live getrennt — hole alle 30 s');
    });
  }

  /* Realtime kann still wegbrechen (Standby, WLAN-Wechsel). Der Nachzieher
     kostet vier winzige Selects und haelt die Anzeige ehrlich. */
  function startSafetyNet() {
    setInterval(function () { if (client) DB.refetch(false); }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && client) DB.refetch(false);
    });
  }

  /* ---------------------------------------------------------- Schreiben */

  function localUpsert(table, row, keys) {
    var arr = DB.data[table];
    var i = arr.findIndex(function (r) {
      return keys.every(function (k) { return r[k] === row[k]; });
    });
    if (i === -1) arr.push(row); else arr[i] = Object.assign({}, arr[i], row);
    cache(); emit();
  }
  function localDelete(table, match) {
    DB.data[table] = DB.data[table].filter(function (r) {
      return !Object.keys(match).every(function (k) { return r[k] === match[k]; });
    });
    cache(); emit();
  }

  function push(table, row, conflict, keys) {
    localUpsert(table, row, keys);              // sofort sichtbar, auch offline
    if (!client) return Promise.resolve(true);
    return client.from(table).upsert(row, { onConflict: conflict }).then(function (res) {
      if (res.error) {
        setStatus('bad', 'Speichern fehlgeschlagen: ' + res.error.message);
        console.error('[db] upsert ' + table, res.error);
        return false;
      }
      return true;
    });
  }

  /* Teiländerung an einer bestehenden Zeile.
     KEIN upsert: PostgREST schickt daraus ein INSERT ... ON CONFLICT, und
     Postgres prueft NOT NULL schon beim Bilden der Zeile — ein Teil-Upsert
     ohne `name` scheitert also, bevor der Konflikt ueberhaupt erkannt wird
     ("null value in column name violates not-null constraint"). */
  function patch(table, id, fields) {
    fields.updated_at = new Date().toISOString();
    localUpsert(table, Object.assign({ id: id }, fields), ['id']);
    if (!client) return Promise.resolve(true);
    return client.from(table).update(fields).eq('id', id).then(function (res) {
      if (res.error) {
        setStatus('bad', 'Speichern fehlgeschlagen: ' + res.error.message);
        console.error('[db] update ' + table, res.error);
        return false;
      }
      return true;
    });
  }

  DB.saveChar = function (c) {
    c.updated_at = new Date().toISOString();
    return push('chars', c, 'id', ['id']);
  };

  /* Ein- und Ausloggen. user = Name oder null (= Charakter ist wieder frei).
     Nur ein Teil-Upsert, damit gleichzeitige Aenderungen an Name/Notiz nicht
     ueberschrieben werden. */
  DB.setNote = function (charId, note) {
    return patch('chars', charId, { note: String(note || '') });
  };

  DB.setLogin = function (charId, user) {
    var fields = {
      logged_in_by: user || null,
      logged_in_at: user ? new Date().toISOString() : null
    };
    // Wer sich einloggt, uebernimmt den Charakter auch — er steht dann unter
    // seinem Namen in der Liste. Beim Ausloggen bleibt der Besitz, wo er ist.
    if (user) fields.owner = user;
    return patch('chars', charId, fields);
  };

  DB.deleteChar = function (id) {
    localDelete('timers', { char_id: id });
    localDelete('chars', { id: id });
    if (!client) return Promise.resolve(true);
    return client.from('timers').delete().eq('char_id', id).then(function () {
      return client.from('chars').delete().eq('id', id);
    }).then(function (res) {
      if (res && res.error) setStatus('bad', 'Löschen fehlgeschlagen: ' + res.error.message);
      return true;
    });
  };

  DB.setTimer = function (charId, runKey, startedAt, endsAt, user) {
    var existing = DB.data.timers.find(function (t) {
      return t.char_id === charId && t.run_key === runKey;
    });
    var row = {
      id: existing ? existing.id : U.uuid(),
      char_id: charId,
      run_key: runKey,
      started_at: new Date(startedAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      by_user: user || '',
      // Mit dem Lauf ist die Anmeldung verbraucht — sonst bliebe eine alte
      // Uhrzeit stehen, die nichts mehr bedeutet.
      registered_at: null,
      updated_at: new Date().toISOString()
    };
    return push('timers', row, 'char_id,run_key', ['char_id', 'run_key']);
  };

  /* Anmeldung ("Regi") — haengt an derselben Zeile, unabhaengig vom Cooldown.
     ts = Zeitstempel oder null zum Loeschen. */
  DB.setRegistration = function (charId, runKey, ts, user) {
    var existing = DB.data.timers.find(function (t) {
      return t.char_id === charId && t.run_key === runKey;
    });
    if (!ts && !existing) return Promise.resolve(true);

    var row = {
      id: existing ? existing.id : U.uuid(),
      char_id: charId,
      run_key: runKey,
      registered_at: ts ? new Date(ts).toISOString() : null,
      by_user: user || (existing ? existing.by_user : ''),
      updated_at: new Date().toISOString()
    };
    // Eine neue Zeile traegt noch keinen Cooldown.
    if (!existing) { row.started_at = null; row.ends_at = null; }
    return push('timers', row, 'char_id,run_key', ['char_id', 'run_key']);
  };

  DB.clearTimer = function (charId, runKey) {
    // Steht noch eine Anmeldung in der Zeile, bleibt die Zeile stehen und nur
    // der Cooldown wird geleert.
    var existing = DB.data.timers.find(function (t) {
      return t.char_id === charId && t.run_key === runKey;
    });
    if (existing && existing.registered_at) {
      return push('timers', {
        id: existing.id, char_id: charId, run_key: runKey,
        started_at: null, ends_at: null, updated_at: new Date().toISOString()
      }, 'char_id,run_key', ['char_id', 'run_key']);
    }
    localDelete('timers', { char_id: charId, run_key: runKey });
    if (!client) return Promise.resolve(true);
    return client.from('timers').delete().eq('char_id', charId).eq('run_key', runKey)
      .then(function (res) {
        if (res.error) setStatus('bad', 'Löschen fehlgeschlagen: ' + res.error.message);
        return true;
      });
  };

  DB.saveSpawn = function (sp) {
    sp.updated_at = new Date().toISOString();
    return push('spawns', sp, 'id', ['id']);
  };

  DB.deleteSpawn = function (id) {
    localDelete('spawns', { id: id });
    if (!client) return Promise.resolve(true);
    return client.from('spawns').delete().eq('id', id).then(function () { return true; });
  };

  DB.spawns = function () {
    return DB.data.spawns.slice().sort(function (a, b) {
      return (a.sort || 0) - (b.sort || 0) || String(a.label).localeCompare(String(b.label));
    });
  };

  /* Run-Beute: was ein Run im Schnitt abwirft. Das weiss keine API, das
     tragen wir selbst ein — deshalb schreibbar. */
  DB.saveRunLoot = function (row) {
    row.updated_at = new Date().toISOString();
    return push('run_loot', row, 'id', ['id']);
  };

  DB.deleteRunLoot = function (id) {
    localDelete('run_loot', { id: id });
    if (!client) return Promise.resolve(true);
    return client.from('run_loot').delete().eq('id', id).then(function () { return true; });
  };

  function overrideRow(vnum) {
    return DB.data.price_overrides.find(function (r) {
      return Number(r.vnum) === Number(vnum);
    }) || null;
  }

  function dropOverride(vnum) {
    localDelete('price_overrides', { vnum: Number(vnum) });
    if (!client) return Promise.resolve(true);
    return client.from('price_overrides').delete().eq('vnum', Number(vnum))
      .then(function () { return true; });
  }

  function saveOverride(vnum, fields, name, user) {
    var old = overrideRow(vnum) || {};
    var row = {
      server: '[DIA] Blos',
      vnum: Number(vnum),
      name: String(name || old.name || ''),
      price: 'price' in fields ? Math.round(fields.price) : (Number(old.price) || 0),
      ignored: 'ignored' in fields ? !!fields.ignored : !!old.ignored,
      by_user: user || old.by_user || '',
      updated_at: new Date().toISOString()
    };
    // Nichts mehr zu merken -> Zeile weg, dann zaehlt wieder der Markt.
    if (!row.price && !row.ignored) return dropOverride(vnum);
    return push('price_overrides', row, 'server,vnum', ['server', 'vnum']);
  }

  /* Preis von Hand setzen. price = 0 nimmt die Ueberschreibung zurueck. */
  DB.setPriceOverride = function (vnum, price, name, user) {
    return saveOverride(vnum, { price: price || 0 }, name, user);
  };

  /* "zählt nicht": der Drop faellt aus dem Erwartungswert heraus — fuer alles,
     was man ohnehin liegen laesst. Unabhaengig vom Preis, damit ein gesetzter
     Wert erhalten bleibt, wenn man es wieder mitzaehlt. */
  DB.setPriceIgnored = function (vnum, on, name, user) {
    return saveOverride(vnum, { ignored: !!on }, name, user);
  };

  DB.lootFor = function (runKey) {
    return DB.data.run_loot
      .filter(function (r) { return r.run_key === runKey; })
      .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  };

  DB.saveRunType = function (rt) {
    rt.updated_at = new Date().toISOString();
    return push('run_types', rt, 'key', ['key']);
  };

  DB.deleteRunType = function (key) {
    localDelete('run_types', { key: key });
    if (!client) return Promise.resolve(true);
    return client.from('run_types').delete().eq('key', key).then(function () { return true; });
  };

  /* -------------------------------------------------------- Abfragen */

  DB.runTypes = function () {
    return DB.data.run_types
      .filter(function (r) { return r.enabled !== false; })
      .slice()
      .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  };

  DB.timerFor = function (charId, runKey) {
    return DB.data.timers.find(function (t) {
      return t.char_id === charId && t.run_key === runKey;
    }) || null;
  };

  /* Laeuft gerade ein Cooldown? (Eine Zeile kann auch nur eine Anmeldung sein.) */
  DB.runningUntil = function (t) {
    if (!t || !t.ends_at) return 0;
    var end = Date.parse(t.ends_at);
    return end > Date.now() ? end : 0;
  };
})();
