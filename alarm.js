/* Ton + Benachrichtigung.
 *
 * Alles hier ist rein oertlich: Einstellungen und eigene Toene liegen im
 * localStorage dieses Browsers. Wer welchen Ton hoert, entscheidet also jeder
 * fuer sich — es waere unhoeflich, allen anderen den eigenen Klingelton
 * aufzuzwingen.
 */
(function () {
  'use strict';

  var OPT_KEY   = 'm2rt.alarm.v1';
  var SOUND_KEY = 'm2rt.sounds.v1';   // { runKey|'_default'|'_spawn': dataURI }

  var A = window.ALARM = {};

  A.opts = Object.assign({
    sound: true,
    notify: false,
    spawn: false,
    lead: 0,          // Sekunden Vorwarnung
    volume: 0.6
  }, U.store.get(OPT_KEY, {}));

  A.sounds = U.store.get(SOUND_KEY, {});

  A.saveOpts = function () { U.store.set(OPT_KEY, A.opts); };

  A.saveSounds = function () {
    if (!U.store.set(SOUND_KEY, A.sounds)) {
      return 'Der Ton passt nicht mehr in den Browser-Speicher — nimm eine kleinere Datei.';
    }
    return '';
  };

  /* --------------------------------------------------------------- Ton */

  var ctx = null;
  function audioCtx() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!ctx) ctx = new C();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* Standardton ohne Datei: zwei kurze Toene. Reicht als Signal und kostet
     kein Byte im Repo. */
  function beep(volume) {
    var c = audioCtx();
    if (!c) return;
    [0, 0.22].forEach(function (offset, i) {
      var osc = c.createOscillator();
      var gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = i === 0 ? 880 : 1245;
      gain.gain.value = 0.0001;
      osc.connect(gain); gain.connect(c.destination);
      var t = c.currentTime + offset;
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.start(t); osc.stop(t + 0.2);
    });
  }

  A.play = function (key) {
    if (!A.opts.sound) return;
    var src = A.sounds[key] || A.sounds._default;
    if (!src) return beep(A.opts.volume);
    try {
      var el = new Audio(src);
      el.volume = Math.max(0, Math.min(1, A.opts.volume));
      var p = el.play();
      if (p && p.catch) p.catch(function () { beep(A.opts.volume); });
    } catch (e) {
      beep(A.opts.volume);
    }
  };

  /* Datei -> Data-URI (bleibt im localStorage, deshalb die Groessenbremse). */
  A.setSoundFile = function (key, file) {
    return new Promise(function (resolve) {
      if (!file) { delete A.sounds[key]; A.saveSounds(); return resolve(''); }
      if (file.size > 1200000) {
        return resolve('Datei ist zu groß (' + Math.round(file.size / 1024) + ' kB). Bis ca. 1 MB.');
      }
      var fr = new FileReader();
      fr.onload = function () {
        A.sounds[key] = fr.result;
        var err = A.saveSounds();
        if (err) delete A.sounds[key];
        resolve(err);
      };
      fr.onerror = function () { resolve('Datei konnte nicht gelesen werden.'); };
      fr.readAsDataURL(file);
    });
  };

  A.clearSound = function (key) {
    delete A.sounds[key];
    A.saveSounds();
  };

  /* ---------------------------------------------------- Benachrichtigung */

  A.notifyState = function () {
    if (!('Notification' in window)) return 'not-supported';
    return Notification.permission;   // default | granted | denied
  };

  A.askNotify = function () {
    if (!('Notification' in window)) return Promise.resolve('not-supported');
    if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
    return Notification.requestPermission();
  };

  A.notify = function (title, body) {
    if (!A.opts.notify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      var n = new Notification(title, { body: body, icon: 'favicon.svg', tag: title + body });
      n.onclick = function () { window.focus(); n.close(); };
      setTimeout(function () { try { n.close(); } catch (e) {} }, 20000);
    } catch (e) { /* z. B. file:// in manchen Browsern */ }
  };

  /* Ein Ereignis = Ton + Benachrichtigung. */
  A.fire = function (soundKey, title, body) {
    A.play(soundKey);
    A.notify(title, body);
  };
})();
