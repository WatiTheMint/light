// Цикл, ввод, экраны, сохранение.
(function () {
  'use strict';
  const L = window.L;
  const A = L.audio, R = L.render, TUNE = L.TUNE;
  const { clamp } = L.util;
  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pgs:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pgs:' + k, JSON.stringify(v)); } catch (e) { /* без сохранений */ } },
  };

  const G = (L.game = {
    mode: 'title', world: null, night: 0, dawn: 0, paused: false, freeze: false, bot: false, seed: null,
    fx: [], hints: [], hintQ: [], hintT: 0, hintGap: 0, capT: 0,
    cursor: null, keys: {}, finaleT: -1, extT: -1, final: false, onNext: null, busy: false,
    results: store.get('results', []),
  });

  const cv = $('sea');
  R.init(cv);
  $('journal').style.backgroundImage = `url(${R.paperGrainURL()})`;

  const aspect = () => { const { W, H } = R.size(); return W / Math.max(1, H); };
  const seed = (n) => (G.seed != null ? G.seed + n : (Date.now() ^ (n * 7919)) >>> 0);
  const label = (b) => (b.plain ? b.name : `«${b.name}»`);

  // ---------- переходы ----------
  function fadeOut(id, cb) {
    const el = $(id);
    el.style.transition = 'opacity .7s cubic-bezier(.22,.61,.36,1)';
    el.style.opacity = '0';
    setTimeout(() => {
      el.hidden = true;
      el.style.opacity = '';
      el.style.transition = '';
      if (cb) cb();
    }, reduced ? 60 : 700);
  }
  function showScreen(id) {
    const el = $(id);
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  function toTitle() {
    G.mode = 'title';
    G.paused = false;
    G.dawn = 0;
    G.final = false;
    G.world = new L.World(0, aspect(), seed(0), { demo: true });
    ['journal', 'pause', 'finalPrompt'].forEach((id) => { $(id).hidden = true; });
    $('hud').hidden = true;
    $('hud').classList.remove('fade');
    document.body.classList.remove('playing');
    const saved = store.get('night', 0);
    const start = $('startBtn'), cont = $('continueBtn');
    if (saved > 0 && saved < L.NIGHTS.length) {
      cont.hidden = false;
      cont.textContent = 'Продолжить · ночь ' + L.NIGHTS[saved].num;
      cont.classList.add('primary');
      start.classList.remove('primary');
      start.textContent = 'Начать сначала';
    } else {
      cont.hidden = true;
      start.classList.add('primary');
      start.textContent = 'Зажечь фонарь';
    }
    showScreen('title');
  }

  function showJournal(page, opts) {
    G.mode = 'journal';
    $('hud').hidden = true;
    $('finalPrompt').hidden = true;
    document.body.classList.remove('playing');
    $('jTitle').textContent = page.title;
    const jt = $('jText');
    jt.textContent = '';
    for (const p of page.text) { const el = document.createElement('p'); richText(el, p); jt.appendChild(el); }
    if (page.last) { const el = document.createElement('p'); el.className = 'last'; el.textContent = page.last; jt.appendChild(el); }
    const box = $('jTally');
    box.textContent = '';
    if (opts.tally) {
      const { home, total, gone } = opts.tally;
      const dots = document.createElement('div');
      dots.className = 'jt-dots';
      dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < total; i++) { const d = document.createElement('i'); if (i >= home) d.className = 'gone'; dots.appendChild(d); }
      const line = document.createElement('span');
      line.textContent = `Довела до причала: ${home} из ${total}.` + (gone ? ' Остальные пришли сами, к утру.' : '');
      box.append(dots, line);
    }
    $('jBtn').textContent = opts.btn;
    G.onNext = opts.onNext;
    const sec = $('journal');
    showScreen('journal');
    sec.scrollTop = 0;
    const pg = sec.querySelector('.page');
    pg.classList.remove('reveal');
    void pg.offsetWidth;
    pg.classList.add('reveal');
    setTimeout(() => { if (G.mode === 'journal') $('jBtn').focus({ preventScroll: true }); }, reduced ? 50 : 1100);
  }

  function startNight(n) {
    const N = L.NIGHTS[n];
    G.night = n;
    G.mode = 'play';
    G.paused = false;
    G.dawn = 0;
    G.final = false;
    G.fx = [];
    G.finaleT = -1;
    G.extT = -1;
    G.hintQ = [];
    G.hintT = 0;
    G.hintGap = 0;
    G.capT = 0;
    G.world = new L.World(n, aspect(), seed(n));
    G.hints = (N.hints || []).map((h) => Object.assign({ done: false }, h));
    $('hud').hidden = false;
    $('hud').classList.remove('fade');
    $('caption').classList.remove('show');
    $('hint').classList.remove('show');
    $('finalPrompt').hidden = true;
    document.body.classList.add('playing');
    $('hudNum').textContent = N.num;
    const tally = $('tally');
    tally.textContent = '';
    N.boats.forEach((b) => {
      const d = document.createElement('span');
      d.className = 'dot';
      d.setAttribute('role', 'listitem');
      d.setAttribute('aria-label', label(Object.assign({}, L.BOATS[b.id])) + ': ещё не вышла');
      tally.appendChild(d);
    });
    $('hornBtn').hidden = !N.horn;
    const card = $('nightCard');
    $('ncNum').textContent = N.num;
    $('ncTitle').textContent = N.title;
    card.classList.remove('run');
    void card.offsetWidth;
    card.classList.add('run');
    store.set('night', n);
    A.init();
  }

  function beginDawn() {
    const w = G.world;
    G.mode = 'dawn';
    G.dawn = 0;
    G.results[G.night] = { home: w.homeCount, total: w.total, gone: w.goneCount };
    store.set('results', G.results);
    A.dawn();
  }

  function endDawn() {
    const w = G.world;
    if (G.final) {
      store.set('night', 0);
      store.set('finished', true);
      showJournal(L.FINALE, { btn: 'Сначала', onNext: () => toTitle() });
      return;
    }
    const n = G.night, N = L.NIGHTS[n];
    store.set('night', n + 1);
    const j = N.journal;
    showJournal({ title: j.title, text: w.goneCount ? j.some : j.all }, {
      tally: { home: w.homeCount, total: w.total, gone: w.goneCount },
      btn: 'Зажечь фонарь',
      onNext: () => startNight(n + 1),
    });
  }

  function beginFinale() {
    G.mode = 'finale';
    G.finaleT = 0;
    G.results[G.night] = { home: G.world.homeCount, total: G.world.total, gone: G.world.goneCount };
    store.set('results', G.results);
  }

  function extinguish() {
    if (G.extT >= 0) return;
    $('finalPrompt').hidden = true;
    G.world.lampOn = false;
    G.extT = 0;
    A.extinguish();
    $('hud').classList.add('fade');
  }

  // Имя внука частично угасает: все его формы в тексте оборачиваются в span.fade-name.
  function richText(el, text) {
    el.textContent = '';
    const re = L.FADE_NAME;
    if (!re) { el.textContent = text; return; }
    re.lastIndex = 0;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const s = document.createElement('span');
      s.className = 'fade-name';
      s.textContent = m[0];
      el.appendChild(s);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  // ---------- подсказки и подписи ----------
  function caption(main, sub) {
    const c = $('caption');
    c.textContent = '';
    const a = document.createElement('span'); a.className = 'c-name'; richText(a, main);
    const b = document.createElement('span'); b.className = 'c-who'; b.textContent = sub;
    c.append(a, b);
    c.classList.add('show');
    G.capT = 4;
  }
  function triggerHints(on, b) {
    for (const h of G.hints) {
      if (h.done || h.on !== on) continue;
      if (on === 'home' && G.world.homeCount !== h.n) continue;
      if (on === 'spawn' && h.id && (!b || b.id !== h.id)) continue;
      h.done = true;
      G.hintQ.push(h.text);
    }
  }
  function updateHints(dt) {
    const w = G.world;
    for (const h of G.hints) if (!h.done && h.at != null && w.t >= h.at) { h.done = true; G.hintQ.push(h.text); }
    const el = $('hint');
    if (G.hintT > 0) {
      G.hintT -= dt;
      if (G.hintT <= 0) { el.classList.remove('show'); G.hintGap = 1.1; }
    } else if (G.hintGap > 0) {
      G.hintGap -= dt;
    } else if (G.hintQ.length) {
      const text = G.hintQ.shift();
      el.textContent = text;
      el.classList.add('show');
      G.hintT = clamp(text.length * 0.08, 4.5, 8.5);
    }
    if (G.capT > 0) { G.capT -= dt; if (G.capT <= 0) $('caption').classList.remove('show'); }
  }

  function setDot(i, st) {
    const d = $('tally').children[i];
    if (!d) return;
    d.className = 'dot ' + st;
    const name = d.getAttribute('aria-label').split(':')[0];
    d.setAttribute('aria-label', name + ': ' + ({ sea: 'в море', home: 'дома', gone: 'ждёт рассвета' }[st] || ''));
  }

  function drainEvents() {
    const w = G.world;
    while (w.events.length) {
      const e = w.events.shift(), b = e.boat;
      switch (e.type) {
        case 'spawn': setDot(b.idx, 'sea'); triggerHints('spawn', b); break;
        case 'home':
          setDot(b.idx, 'home');
          A.home(w.homeCount);
          caption(`${label(b)} дома`, b.who);
          G.fx.push({ text: label(b), x: w.hx, y: w.pierTop, t0: w.t, fade: !!b.fade });
          triggerHints('home', b);
          if (b.special) beginFinale();
          break;
        case 'gone': setDot(b.idx, 'gone'); A.gone(); caption(`${label(b)} ждёт рассвета в тумане`, b.who); break;
        case 'bump': A.bump(); break;
        case 'horn': A.horn(); break;
        case 'done': if (G.mode === 'play') beginDawn(); break;
      }
    }
  }

  // ---------- ввод ----------
  let touching = false;
  function aimAt(x, y) { const p = R.toWorld(x, y); G.world.setAim(p.x, p.y); }
  const steering = () => (G.mode === 'play' || G.mode === 'finale') && !G.paused;
  cv.addEventListener('pointerdown', (e) => {
    if (!steering()) return;
    if (e.button === 2) { horn(); return; }
    touching = true;
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* старые браузеры */ }
    aimAt(e.clientX, e.clientY);
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && !touching) return;
    G.cursor = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
    if (steering()) aimAt(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', () => { touching = false; });
  window.addEventListener('pointercancel', () => { touching = false; });
  cv.addEventListener('pointerleave', () => { G.cursor = null; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  const KEYMAP = {
    ArrowLeft: 'L', a: 'L', A: 'L', 'ф': 'L', 'Ф': 'L',
    ArrowRight: 'R', d: 'R', D: 'R', 'в': 'R', 'В': 'R',
    ArrowUp: 'U', w: 'U', W: 'U', 'ц': 'U', 'Ц': 'U',
    ArrowDown: 'D', s: 'D', S: 'D', 'ы': 'D', 'Ы': 'D',
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ('mMьЬ'.includes(k) && k.length === 1) { toggleMute(); return; }
    if (G.mode === 'play' || G.mode === 'finale') {
      if (k === 'Escape' || 'pPзЗ'.includes(k) && k.length === 1) { e.preventDefault(); setPaused(!G.paused); return; }
      if (G.paused) return;
      if (G.mode === 'play' && (k === ' ' || ('hHрР'.includes(k) && k.length === 1))) {
        e.preventDefault();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        horn();
        return;
      }
      if (KEYMAP[k]) { G.keys[KEYMAP[k]] = true; e.preventDefault(); }
    }
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.key]) G.keys[KEYMAP[e.key]] = false; });
  window.addEventListener('blur', () => { G.keys = {}; });

  function horn() { if (G.mode === 'play' && !G.paused) G.world.blowHorn(); }

  function setPaused(p) {
    if (p && G.mode !== 'play' && G.mode !== 'finale') return;
    G.paused = p;
    G.keys = {};
    $('pause').hidden = !p;
    if (p) { syncMute(); $('resumeBtn').focus({ preventScroll: true }); }
  }
  function syncMute() {
    const m = A.isMuted();
    $('muteBtn').setAttribute('aria-pressed', String(m));
    $('muteBtn').setAttribute('aria-label', m ? 'Включить звук' : 'Выключить звук');
    $('pMuteBtn').textContent = 'Звук: ' + (m ? 'выкл' : 'вкл');
  }
  function toggleMute() { A.setMuted(!A.isMuted()); store.set('mute', A.isMuted()); syncMute(); }
  A.setMuted(store.get('mute', false));
  syncMute();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (G.mode === 'play') setPaused(true);
      A.suspend();
    } else {
      A.resume();
    }
  });
  window.addEventListener('resize', () => {
    R.resize();
    if (G.mode === 'title') G.world = new L.World(0, aspect(), seed(0), { demo: true });
  });

  // ---------- кнопки ----------
  const once = (fn) => () => { if (G.busy) return; G.busy = true; setTimeout(() => { G.busy = false; }, 800); fn(); };
  $('startBtn').addEventListener('click', once(() => {
    A.init();
    store.set('night', 0);
    showJournal(L.PROLOGUE, { btn: 'Зажечь фонарь', onNext: () => startNight(0) });
    setTimeout(() => { $('title').hidden = true; }, reduced ? 50 : 1100);
  }));
  $('continueBtn').addEventListener('click', once(() => {
    A.init();
    startNight(clamp(store.get('night', 0), 0, L.NIGHTS.length - 1));
    fadeOut('title');
  }));
  $('jBtn').addEventListener('click', once(() => {
    const next = G.onNext;
    G.onNext = null;
    if (next) next();
    fadeOut('journal');
  }));
  $('resumeBtn').addEventListener('click', () => setPaused(false));
  $('pMuteBtn').addEventListener('click', toggleMute);
  $('menuBtn').addEventListener('click', () => { setPaused(false); toTitle(); });
  $('muteBtn').addEventListener('click', toggleMute);
  $('pauseBtn').addEventListener('click', () => setPaused(true));
  $('hornBtn').addEventListener('click', horn);
  $('extBtn').addEventListener('click', extinguish);

  // ---------- цикл ----------
  function tick(dt) {
    const sw = G.world;
    A.scene({ mode: G.mode, fog: sw ? sw.fog : 0, dawn: G.dawn, paused: G.paused, lampOn: sw ? sw.lampOn : true });
    A.tick(dt, G.mode !== 'play');
    if (G.paused || !G.world) return;
    const w = G.world;
    if (G.mode === 'title') { w.demoAim(); w.update(dt); return; }
    if (G.mode === 'journal') return;

    if (G.mode === 'play' || G.mode === 'finale') {
      const kx = (G.keys.R ? 1 : 0) - (G.keys.L ? 1 : 0), ky = (G.keys.U ? 1 : 0) - (G.keys.D ? 1 : 0);
      if (kx || ky) { w.nudgeAim(kx * 1.6 * dt, ky * 60 * dt); G.cursor = null; }
      if (G.bot && G.mode === 'play') w.botAim();
    }
    w.update(dt);
    drainEvents();
    updateHints(dt);

    const hb = $('hornBtn');
    if (!hb.hidden) {
      $('hornRing').style.strokeDashoffset = (182.2 * (w.horn.cd / TUNE.hornCd)).toFixed(1);
      hb.classList.toggle('cool', w.horn.cd > 0);
    }

    if (G.mode === 'finale') {
      G.finaleT += dt;
      if (G.finaleT > 2.4 && G.extT < 0 && $('finalPrompt').hidden) {
        $('finalPrompt').hidden = false;
        $('extBtn').focus({ preventScroll: true });
      }
    }
    if (G.extT >= 0 && G.mode === 'finale') {
      G.extT += dt;
      if (G.extT > 2.6) { G.mode = 'dawn'; G.final = true; G.dawn = 0; A.dawn(); }
    }
    if (G.mode === 'dawn') {
      G.dawn = Math.min(1, G.dawn + dt / (reduced ? 2.5 : 5.5));
      if (G.dawn > 0.25) $('hud').classList.add('fade');
      if (G.dawn >= 1) endDawn();
    }
  }

  function draw() {
    if (!G.world || G.mode === 'journal') return;
    const cursor = (G.mode === 'play' || G.mode === 'finale') && !G.paused ? G.cursor : null;
    R.draw(G.world, { dawn: G.dawn, fx: G.fx, reduced, cursor });
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!G.freeze) tick(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // Отладка: L.game.start(n), .sim(сек), .snap(имя) — снимок в .snaps/ через serve.js.
  G.start = startNight;
  G.title = toTitle;
  G.tick = tick;
  G.draw = draw;
  G.sim = (sec, step) => { step = step || 1 / 60; for (let i = 0; i < sec / step; i++) tick(step); draw(); };
  G.snap = (name) => fetch('/__snap/' + name, { method: 'POST', body: cv.toDataURL('image/png') }).then((r) => r.text());

  toTitle();
  requestAnimationFrame(frame);
})();
