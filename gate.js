/* Zugang zur Seite: Name + Passwort. Gleiches Passwort wie beim Zodiak-Helfer —
   der Hash steht hier, das Passwort selbst nirgends im Repo.
   Der Name wird als "Spieler" an neue Charaktere gehaengt. */

(function () {
  'use strict';

  var PASS_HASH = 'f8a3149f';
  var KEY = 'm2rt.gate.v1';

  function fnv1a(s) {
    var x = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16);
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  var state = load();
  var listeners = [];

  window.ZGATE = {
    user: function () { return state.user || ''; },
    setUser: function (name) {
      state.user = String(name || '').trim().slice(0, 40);
      save(state);
      listeners.forEach(function (fn) { try { fn(state.user); } catch (e) {} });
      return state.user;
    },
    onUser: function (fn) { listeners.push(fn); },
    /* Namen nachtraeglich aendern (Kopfzeilen-Button). */
    ask: function () {
      var name = prompt('Dein Spielername:', state.user || '');
      if (name === null) return;
      window.ZGATE.setUser(name);
    }
  };

  function unlock() {
    document.body.classList.remove('locked');
    var ov = document.getElementById('gate');
    if (ov) ov.hidden = true;
  }

  function build() {
    var ov = document.createElement('div');
    ov.id = 'gate';
    ov.className = 'gate';
    ov.innerHTML =
      '<form class="gate-box" autocomplete="on">' +
        '<div class="gate-title">Metin2 Run-Tracker</div>' +
        '<p class="gate-sub">Name und Passwort. Der Name steht bei deinen Charakteren, ' +
          'damit man sieht, wessen Timer das sind.</p>' +
        '<label class="gate-l" for="gateUser">Name</label>' +
        '<input class="txt" id="gateUser" name="username" autocomplete="username" ' +
               'placeholder="z. B. Jogoe" maxlength="40" />' +
        '<label class="gate-l" for="gatePass">Passwort</label>' +
        '<input class="txt" id="gatePass" name="password" type="password" ' +
               'autocomplete="current-password" />' +
        '<button class="btn primary big" type="submit">Rein</button>' +
        '<p class="gate-err" id="gateErr" hidden></p>' +
      '</form>';
    document.body.appendChild(ov);

    var user = document.getElementById('gateUser');
    var pass = document.getElementById('gatePass');
    var err = document.getElementById('gateErr');
    user.value = state.user || '';

    ov.querySelector('form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = user.value.trim();
      if (!name) {
        err.hidden = false;
        err.textContent = 'Bitte einen Namen eintragen.';
        user.focus();
        return;
      }
      if (fnv1a(pass.value) !== PASS_HASH) {
        err.hidden = false;
        err.textContent = 'Falsches Passwort.';
        pass.value = '';
        pass.focus();
        return;
      }
      state.user = name.slice(0, 40);
      state.ok = true;
      save(state);
      unlock();
    });

    (state.user ? pass : user).focus();
  }

  document.body.classList.add('locked');
  build();
  if (state.ok) unlock();
})();
