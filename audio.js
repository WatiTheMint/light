// Звук: море, колокольчики возвращений, ревун, редкие ноты. Всё синтезируется на лету.
(function () {
  'use strict';
  const L = window.L;
  const A = (L.audio = {});
  let ctx = null, master = null, revIn = null, muted = false, musicT = 3, musicVol = 1;

  // си-минорная пентатоника (те же ноты, что ре-мажорная): грусть с просветом
  const LOW = [123.47, 146.83, 164.81, 185.0, 220.0, 246.94];
  const CHIME = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0];

  // Фоновая музыка — кавер «Stranded Lullaby». Идёт через фильтр (туман глушит, рассвет раскрывает) и ревербер.
  const MUSIC_URL = 'audio/lullaby.mp3';
  const MUSIC_VOL = 0.46;
  let music = null, pulse = 0, duckT = 0, duck = 1, sceneT = 0;
  const want = { cut: 3000, vol: 0.8 };

  A.isMuted = () => muted;
  A.ready = () => !!ctx;
  A.musicState = () => (music ? { ok: !!music.ok, failed: !!music.failed, direct: !!music.direct, paused: music.el.paused, t: music.el.currentTime, cut: music.lp ? Math.round(music.lp.frequency.value) : null, gain: music.g ? +music.g.gain.value.toFixed(3) : null } : null);
  const musicLive = () => music && !music.failed;

  function initMusic() {
    if (music) return;
    const el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.src = MUSIC_URL;
    music = { el };
    el.addEventListener('playing', () => { music.ok = true; });
    el.addEventListener('error', () => { if (music.lp) bufferFallback(); else music.failed = true; });
    // С file:// браузер не отдаёт звук элемента в WebAudio — тогда играем напрямую, без эффектов.
    if (location.protocol === 'file:') {
      music.direct = true;
      el.volume = muted ? 0 : MUSIC_VOL;
    } else {
      try {
        const src = ctx.createMediaElementSource(el);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 0.6; lp.frequency.value = 2400;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        src.connect(lp); lp.connect(g); g.connect(master);
        const send = ctx.createGain();
        send.gain.value = 0.22;
        g.connect(send); send.connect(revIn);
        Object.assign(music, { lp, g });
      } catch (e) {
        music.direct = true;
      }
    }
    const p = el.play();
    if (p && p.catch) p.catch(() => { music.blocked = true; });
  }

  // Запасной путь, если <audio> не загрузился: скачать файл и проиграть его буфером WebAudio.
  function bufferFallback() {
    if (music.buf) return;
    music.buf = true;
    fetch(MUSIC_URL)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((buf) => {
        const s = ctx.createBufferSource();
        s.buffer = buf; s.loop = true; s.loopEnd = Math.min(buf.duration, 244.5);
        s.connect(music.lp); s.start();
        music.node = s; music.ok = true;
      })
      .catch(() => { music.failed = true; });
  }

  // Что сейчас на экране: от этого зависят глухость и громкость музыки.
  A.scene = function (s) {
    const fogCut = 2700 - 2300 * clamp01(s.fog / 0.45);
    let cut, vol;
    switch (s.mode) {
      case 'title': cut = 3200; vol = 0.75; break;
      case 'journal': cut = 9000; vol = 0.62; break;
      case 'dawn': cut = fogCut + (16000 - fogCut) * s.dawn * s.dawn; vol = 0.85 + 0.15 * s.dawn; break;
      default: cut = s.lampOn === false ? 5200 : fogCut; vol = 0.85;
    }
    if (s.paused) { cut = Math.min(cut, 1200); vol *= 0.45; }
    want.cut = cut;
    want.vol = vol;
  };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v || 0);

  function updateMusic(dt) {
    if (!musicLive()) return;
    pulse *= Math.exp(-dt / 2.4);
    duckT = Math.max(0, duckT - dt);
    duck += ((duckT > 0 ? 0.32 : 1) - duck) * (1 - Math.exp(-dt * (duckT > 0 ? 6 : 0.9)));
    if (music.direct) { music.el.volume = muted ? 0 : MUSIC_VOL * want.vol * duck; return; }
    sceneT -= dt;
    if (sceneT > 0) return;
    sceneT = 1 / 15;
    const now = ctx.currentTime;
    const cut = Math.max(300, Math.min(18000, want.cut * (1 + pulse)));
    music.lp.frequency.setTargetAtTime(cut, now, 0.35);
    music.g.gain.setTargetAtTime(Math.max(0.0001, MUSIC_VOL * want.vol * duck), now, music.ok && music.g.gain.value > 0.01 ? 0.25 : 1.2);
  }

  // Вкладка скрыта — музыка на паузе, чтобы не уходить вперёд без игрока.
  A.suspend = function () { if (!ctx) return; if (music) music.el.pause(); ctx.suspend(); };
  A.resume = function () {
    if (!ctx) return;
    ctx.resume();
    if (music && !music.failed) { const p = music.el.play(); if (p && p.catch) p.catch(() => {}); }
  };

  A.init = function () {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      if (music && (music.blocked || music.el.paused) && !music.failed) { music.blocked = false; const p = music.el.play(); if (p && p.catch) p.catch(() => {}); }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    master.connect(comp); comp.connect(ctx.destination);
    const rev = ctx.createConvolver();
    rev.buffer = impulse(3.8, 2.6);
    revIn = ctx.createGain();
    revIn.gain.value = 0.5;
    revIn.connect(rev); rev.connect(master);
    sea();
    initMusic();
  };

  A.setMuted = function (m) {
    muted = !!m;
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.12);
    if (music && music.direct) music.el.volume = muted ? 0 : MUSIC_VOL;
  };

  function impulse(sec, decay) {
    const sr = ctx.sampleRate, len = Math.floor(sr * sec), b = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  function noiseBuf(sec, brown) {
    const sr = ctx.sampleRate, len = Math.floor(sr * sec), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  function osc(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function out(vol, send) {
    const g = ctx.createGain();
    g.gain.value = vol;
    g.connect(master);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(revIn); }
    return g;
  }

  function sea() {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(6, true); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); g.gain.value = 0.12;
    const lfo = osc('sine', 0.11), lg = ctx.createGain(); lg.gain.value = 0.08; lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = osc('sine', 0.07), lg2 = ctx.createGain(); lg2.gain.value = 180; lfo2.connect(lg2); lg2.connect(lp.frequency);
    src.connect(lp); lp.connect(g); g.connect(master);
    const s2 = ctx.createBufferSource(); s2.buffer = noiseBuf(4, false); s2.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.011;
    const lfo3 = osc('sine', 0.13), lg3 = ctx.createGain(); lg3.gain.value = 0.009; lfo3.connect(lg3); lg3.connect(g2.gain);
    s2.connect(bp); bp.connect(g2); g2.connect(master);
    [src, lfo, lfo2, s2, lfo3].forEach((n) => n.start());
  }

  function bell(freq, vol, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = out(vol, 0.9);
    for (const [m, a, dec] of [[1, 1, 3.4], [2.01, 0.3, 2.2], [3.0, 0.14, 1.4], [4.17, 0.07, 0.9]]) {
      const n = osc('sine', freq * m), g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      n.connect(g); g.connect(o);
      n.start(t); n.stop(t + dec + 0.05);
    }
  }

  function pad(freq, vol, dur, delay) {
    const t = ctx.currentTime + (delay || 0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(1.4, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const o1 = osc('triangle', freq), o2 = osc('sine', freq * 2.003);
    const g2 = ctx.createGain(); g2.gain.value = 0.3;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g);
    const o = out(1, 1.2); g.connect(o);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }

  A.home = function (k) {
    if (!ctx) return;
    const f = CHIME[Math.min(CHIME.length - 1, Math.max(0, k - 1))];
    bell(f, 0.13);
    bell(f / 2, 0.05, 0.02);
    pulse = Math.max(pulse, 0.9); // лодка дома — музыка на миг «выходит из тумана»
  };

  A.horn = function () {
    if (!ctx) return;
    duckT = 2.2;
    const t = ctx.currentTime, dur = 2.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.35);
    g.gain.setValueAtTime(0.2, t + dur - 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.linearRampToValueAtTime(520, t + 0.4);
    lp.frequency.linearRampToValueAtTime(290, t + dur);
    for (const [f, type] of [[87.3, 'sawtooth'], [87.3 * 1.006, 'sawtooth'], [43.65, 'triangle']]) {
      const o = osc(type, f);
      o.frequency.setValueAtTime(f, t + dur - 0.6);
      o.frequency.exponentialRampToValueAtTime(f * 0.82, t + dur);
      o.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    }
    lp.connect(g);
    g.connect(out(1, 1.1));
  };

  A.bump = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = osc('sine', 95), g = ctx.createGain();
    o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g); g.connect(out(1, 0.4));
    o.start(t); o.stop(t + 0.4);
    const n = ctx.createBufferSource(); n.buffer = noiseBuf(0.3, false);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.12, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(lp); lp.connect(ng); ng.connect(master);
    n.start(t);
  };

  A.gone = function () {
    if (!ctx) return;
    pulse = Math.min(pulse, -0.45);
    pad(329.63, 0.04, 2.6);
    pad(246.94, 0.04, 3.2, 0.5);
  };

  A.dawn = function () {
    if (!ctx) return;
    pad(146.83, 0.05, 7);
    pad(293.66, 0.04, 7, 0.3);
    pad(369.99, 0.035, 7, 0.6);
    pad(440.0, 0.03, 7, 0.9);
  };

  A.extinguish = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = noiseBuf(0.08, false);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(hp); hp.connect(g); g.connect(out(1, 0.8));
    n.start(t);
    pad(123.47, 0.05, 5, 0.1);
  };

  // Редкая музыка: одна низкая нота раз в несколько секунд.
  A.tick = function (dt, quiet) {
    if (!ctx) return;
    updateMusic(dt);
    if (muted || musicLive()) return; // под кавер свои ноты не играем — они спорили бы с мелодией

    musicVol += ((quiet ? 0.5 : 1) - musicVol) * Math.min(1, dt);
    musicT -= dt;
    if (musicT <= 0) {
      musicT = 4.5 + Math.random() * 5;
      const f = LOW[(Math.random() * LOW.length) | 0];
      pad(f, 0.045 * musicVol, 5.5);
      if (Math.random() < 0.3) pad(f * 1.5, 0.025 * musicVol, 5, 0.6);
    }
  };
})();
