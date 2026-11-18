// Логика ночи: луч, лодки, скалы, причал. Без рисования — только состояние и события.
(function () {
  'use strict';
  const L = window.L = window.L || {};
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const vnoise = (x, s) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), o = s * 101.3;
    return hash(i + o) * (1 - u) + hash(i + 1 + o) * u;
  };
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  L.util = { TAU, clamp, wrap, sstep, hash, vnoise, mulberry };

  // Баланс в одном месте.
  const TUNE = {
    beamK: 8.4,          // ширина пятна на конце луча (в единицах мира): ha = beamK / r
    minReach: 14,
    turnSpeed: 3.4,      // рад/с — фонарь тяжёлый, поворачивается не мгновенно
    memory: 1.5,         // сколько секунд лодка «помнит» свет после того, как луч ушёл
    vLost: 1.5, vGuided: 4.8,
    hopeGain: 0.07, bumpCost: 0.2,
    hornCd: 10, hornHeard: 4.5,
    revealFade: 0.2,
  };
  L.TUNE = TUNE;

  class World {
    constructor(n, aspect, seed, opts) {
      opts = opts || {};
      this.n = n;
      this.N = L.NIGHTS[n];
      this.demo = !!opts.demo;
      this.seed = seed >>> 0;
      this.rand = mulberry(this.seed);
      this.wh = 100;
      this.ww = 100 * clamp(aspect, 0.56, 1.9);
      this.cx = this.ww / 2;
      this.hx = this.cx + clamp(this.ww * 0.16, 11, 24);
      this.coastSeed = 3 + n * 13;
      this.lamp = { x: this.cx, y: this.coastY(this.cx) + 2.6 };
      this.pierTop = this.coastY(this.hx) - 10.5;
      this.H = { x: this.hx, y: this.pierTop - 1.6 };
      this.t = 0;
      this.events = [];
      this.beam = { a: -0.3, r: 60, ha: 0.14, on: 1 };
      this.aim = { a: -0.3, r: 60 };
      this.lampOn = true;
      this.fog = this.N.fog;
      this.reach = this.N.reach;
      this.wind = this.N.wind;
      this.boats = [];
      this.rocks = [];
      this.queue = this.demo ? [] : this.N.boats.map((b, i) => Object.assign({ idx: i }, b));
      this.total = this.demo ? 0 : this.N.boats.length;
      this.homeCount = 0;
      this.goneCount = 0;
      this.slots = 0;
      this.idle = 0;
      this.horn = { cd: 0, at: -99 };
      this.done = false;
      this.genRocks(this.demo ? 5 : this.N.rocks, this.demo ? false : this.N.teeth);
      this.houses = this.genHouses();
      if (this.demo) {
        for (let i = 0; i < 3; i++) this.spawn({ id: ['chaika', 'sedoy', 'pochta'][i], from: 'top', p: 0.2 + i * 0.3, idx: -1 }, true);
        this.boats.forEach((b, i) => { b.y = 18 + i * 17; b.x = this.ww * (0.22 + i * 0.28); b.alpha = 1; });
      }
    }

    emit(type, boat) { this.events.push({ type, boat }); }

    // Береговая линия: y берега для любого x. Мыс под маяком, бухта у причала.
    coastY(x) {
      let y = 90 + (vnoise(x * 0.06, this.coastSeed) - 0.5) * 3.4 + (vnoise(x * 0.21, this.coastSeed + 4) - 0.5) * 1.4;
      y -= 6.6 * Math.exp(-(((x - this.cx) / 4.2) ** 2));
      y += 5.2 * Math.exp(-(((x - this.hx) / 4.6) ** 2));
      return y;
    }

    genRocks(count, teeth) {
      const R = this.rand;
      const make = (x, y, r) => {
        const k = 7 + ((R() * 4) | 0), pts = [], a0 = R() * TAU;
        for (let i = 0; i < k; i++) {
          const a = a0 + (i / k) * TAU + (R() - 0.5) * 0.5;
          const rr = r * (0.72 + R() * 0.32);
          pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        this.rocks.push({ x, y, r, pts, reveal: 0, lit: 0, ph: R() * TAU });
      };
      if (teeth) {
        // «Зубы» — гряда у входа в бухту, слева сверху от причала.
        const bx = this.H.x - 9, by = this.H.y - 14;
        for (let i = 0; i < 3; i++) make(bx - 4.6 + i * 4.6 + (R() - 0.5), by + (i === 1 ? -1.6 : 0.8), 1.3 + R() * 0.6);
      }
      count = Math.round(count * clamp(this.ww / 130, 0.65, 1.25));
      let tries = 0, placed = 0;
      while (placed < count && tries++ < 4000) {
        const r = 1.5 + R() * 2.5;
        const x = 5 + R() * (this.ww - 10);
        const y = 10 + R() * (this.coastY(x) - 24);
        if (Math.hypot(x - this.H.x, y - this.H.y) < 11 + r) continue;
        if (Math.hypot(x - this.lamp.x, y - this.lamp.y) < 13 + r) continue;
        if (this.rocks.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 6.5)) continue;
        make(x, y, r);
        placed++;
      }
    }

    genHouses() {
      const extra = 2;
      const n = Math.max(this.total, 3) + extra;
      const cands = [];
      for (let x = 4; x < this.ww - 4; x += 3.7) {
        if (Math.abs(x - this.cx) < 6.5) continue;
        if (Math.abs(x - this.hx) < 3.2) continue;
        cands.push(x);
      }
      cands.sort((a, b) => Math.abs(a - this.hx) - Math.abs(b - this.hx));
      const out = [];
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / cands.length);
        const x = cands[i % cands.length] + (this.rand() - 0.5) * 1.1;
        const y = Math.min(this.coastY(x) + 3 + row * 3.4 + this.rand() * 1.4, 98.4);
        const boat = !this.demo && i < this.total ? this.N.boats[i].id : null;
        const startLit = this.demo ? (i % 2 === 0) : boat === null;
        out.push({ x, y, s: 1.45 + this.rand() * 0.5, rot: (this.rand() - 0.5) * 0.35, boat, lit: startLit ? 1 : 0, target: startLit ? 1 : 0 });
      }
      return out;
    }

    // ---------- луч ----------
    setAim(px, py) {
      const dx = px - this.lamp.x, dy = py - this.lamp.y;
      this.aim.a = clamp(Math.atan2(dx, -dy), -1.8, 1.8);
      this.aim.r = Math.hypot(dx, dy);
    }
    nudgeAim(da, dr) {
      this.aim.a = clamp(this.aim.a + da, -1.8, 1.8);
      this.aim.r = clamp(this.aim.r + dr, TUNE.minReach, this.reach);
    }
    updateBeam(dt) {
      const b = this.beam;
      const tr = clamp(this.aim.r, TUNE.minReach, this.reach);
      const da = wrap(this.aim.a - b.a);
      b.a += clamp(da * (1 - Math.exp(-dt * 9)), -TUNE.turnSpeed * dt, TUNE.turnSpeed * dt);
      b.r += (tr - b.r) * (1 - Math.exp(-dt * 7));
      b.ha = clamp(TUNE.beamK / b.r, 0.072, 0.44);
      b.on += ((this.lampOn ? 1 : 0) - b.on) * (1 - Math.exp(-dt * (this.lampOn ? 3 : 1.6)));
    }
    inBeam(x, y, rad) {
      const b = this.beam;
      if (b.on < 0.5) return false;
      const dx = x - this.lamp.x, dy = y - this.lamp.y, d = Math.hypot(dx, dy);
      if (d > b.r + rad) return false;
      if (d < rad + 1.5) return true;
      return Math.abs(wrap(Math.atan2(dx, -dy) - b.a)) <= b.ha + Math.atan2(rad, d);
    }
    // Мягкая освещённость точки 0..1 (для рисования и обнаружения скал).
    lightAt(x, y) {
      const b = this.beam;
      if (b.on <= 0.01) return 0;
      const dx = x - this.lamp.x, dy = y - this.lamp.y, d = Math.hypot(dx, dy);
      if (d > b.r * 1.12) return d < 9 ? sstep(9, 2, d) * b.on : 0;
      const diff = Math.abs(wrap(Math.atan2(dx, -dy) - b.a));
      const ang = sstep(b.ha * 1.35, b.ha * 0.7, diff);
      const fall = sstep(b.r * 1.12, b.r * 0.86, d) * (1 - 0.3 * d / b.r);
      return Math.max(ang * fall, sstep(9, 2, d)) * b.on;
    }

    // ---------- лодки ----------
    spawn(spec, silent) {
      const B = L.BOATS[spec.id], R = this.rand;
      let x, y;
      if (spec.from === 'top') { x = 6 + spec.p * (this.ww - 12); y = -4; }
      else if (spec.from === 'left') { x = -4; y = 8 + spec.p * 52; }
      else { x = this.ww + 4; y = 8 + spec.p * 52; }
      const tx = this.ww * (0.25 + R() * 0.5), ty = 25 + R() * 25;
      const b = {
        id: spec.id, idx: spec.idx, name: B.name, who: B.who, plain: !!B.plain,
        x, y, h: Math.atan2(ty - y, tx - x), v: TUNE.vLost,
        g: 0, mem: 0, heard: 0, hope: 1, stun: 0, alpha: 0, state: 'sea',
        seed: R() * 1000, wob: R() * 50, bob: R() * TAU, trail: [], trailT: 0,
        size: B.size || 1, spd: B.spd || 1, drainK: B.drain == null ? 1 : B.drain,
        special: !!B.special, lit: false, labelA: 0,
      };
      this.boats.push(b);
      if (!silent) this.emit('spawn', b);
      return b;
    }

    updateBoat(b, dt) {
      if (b.state === 'dock') return this.updateDock(b, dt);
      if (b.state === 'home' || b.state === 'out') return;
      if (b.state === 'gone') {
        b.alpha -= dt * 0.33;
        b.v *= Math.pow(0.3, dt);
        this.move(b, dt, 1);
        if (b.alpha <= 0) { b.alpha = 0; b.state = 'out'; }
        return;
      }
      b.alpha = Math.min(1, b.alpha + dt * 0.7);
      const lit = !this.demo && this.inBeam(b.x, b.y, 1.4 * b.size);
      b.lit = lit;
      b.labelA += ((lit || b.mem > 0.6 ? 1 : 0) - b.labelA) * (1 - Math.exp(-dt * 4));
      b.mem = lit ? TUNE.memory : Math.max(0, b.mem - dt);
      b.heard = Math.max(0, b.heard - dt);
      const guided = b.mem > 0;
      const gT = guided ? 1 : b.heard > 0 ? 0.62 : 0;
      b.g += (gT - b.g) * (1 - Math.exp(-dt * (gT > b.g ? 3 : 1.2)));

      let hx = Math.cos(b.h), hy = Math.sin(b.h);
      let dx, dy;
      const tx = this.H.x - b.x, ty = this.H.y - b.y, td = Math.hypot(tx, ty) || 1;
      if (guided || b.heard > 0) {
        dx = tx / td; dy = ty / td;
      } else {
        // Заблудившаяся лодка петляет, но смутно помнит, где дом.
        b.wob += dt * 0.3;
        b.h += (vnoise(b.wob, b.seed) - 0.5) * 0.9 * dt;
        hx = Math.cos(b.h); hy = Math.sin(b.h);
        dx = hx + (tx / td) * 0.22; dy = hy + (ty / td) * 0.22;
      }
      // Обход замеченных скал.
      for (const r of this.rocks) {
        const vis = Math.max(r.reveal, r.lit);
        if (vis < 0.1) continue;
        const rx = r.x - b.x, ry = r.y - b.y, d = Math.hypot(rx, ry) || 0.01;
        const clear = d - r.r * 0.9 - 1.6 * b.size;
        if (clear > 9) continue;
        const fwd = (rx * hx + ry * hy) / d;
        if (fwd < -0.3) continue;
        const w = (1 - Math.max(0, clear) / 9) * (0.5 + Math.max(0, fwd)) * 2.4;
        const cross = hx * ry - hy * rx;
        if (cross >= 0) { dx += hy * w; dy -= hx * w; } else { dx -= hy * w; dy += hx * w; }
        if (clear < 2.5) { const k = (2.5 - clear) * 0.8; dx -= (rx / d) * k; dy -= (ry / d) * k; }
      }
      // Не толкаться бортами.
      for (const o of this.boats) {
        if (o === b || o.state !== 'sea') continue;
        const ox = b.x - o.x, oy = b.y - o.y, d = Math.hypot(ox, oy);
        const min = 1.6 * (b.size + o.size);
        if (d > 0.01 && d < min) { const k = (min - d) / min; dx += (ox / d) * k * 1.5; dy += (oy / d) * k * 1.5; }
      }
      // Края мира и берег.
      const m = 5;
      if (b.x < m) dx += ((m - b.x) / m) * 1.5;
      if (b.x > this.ww - m) dx -= ((b.x - (this.ww - m)) / m) * 1.5;
      if (b.y < m) dy += ((m - b.y) / m) * 1.5;
      const cy = this.coastY(b.x);
      if (b.y > cy - 6) dy -= ((b.y - (cy - 6)) / 6) * 2.2;

      const des = Math.atan2(dy, dx);
      const turnRate = 0.9 + 1.5 * b.g;
      if (b.stun <= 0) b.h += clamp(wrap(des - b.h), -turnRate * dt, turnRate * dt);
      const vT = b.stun > 0 ? 0 : (TUNE.vLost + (TUNE.vGuided - TUNE.vLost) * b.g) * b.spd;
      b.v += (vT - b.v) * (1 - Math.exp(-dt * 1.6));
      b.stun = Math.max(0, b.stun - dt);
      this.move(b, dt, 1 - b.g);

      // Удар о скалу. Корпус — капсула из трёх точек (нос, середина, корма), чтобы длинный паром не «проходил сквозь» камни.
      const hl = 1.05 * b.size, hr = 0.75 * b.size, ch = Math.cos(b.h), sh = Math.sin(b.h);
      for (const r of this.rocks) {
        for (const k of [0, 1, -1]) {
          const px = b.x + ch * hl * k, py = b.y + sh * hl * k;
          const rx = px - r.x, ry = py - r.y, d = Math.hypot(rx, ry) || 0.01;
          const min = r.r * 0.82 + hr;
          if (d >= min) continue;
          b.x += (rx / d) * (min - d); b.y += (ry / d) * (min - d);
          if (b.stun <= 0) {
            b.stun = 1.1; b.v = 0.6; b.hope -= TUNE.bumpCost; r.reveal = 1;
            b.h = Math.atan2(ry, rx) + (this.rand() - 0.5) * 0.8;
            this.emit('bump', b);
          }
          break;
        }
      }
      const cy2 = this.coastY(b.x);
      if (b.y > cy2 - 1.4) b.y = cy2 - 1.4;

      // Надежда = огонёк на корме. Гаснет, пока лодка блуждает.
      if (!this.demo) {
        if (b.g > 0.45) b.hope = Math.min(1, b.hope + dt * TUNE.hopeGain);
        else b.hope -= dt * this.N.drain * b.drainK;
        if (b.special) b.hope = Math.max(b.hope, 0.3);
        if (b.hope <= 0) { b.hope = 0; b.state = 'gone'; this.goneCount++; this.emit('gone', b); return; }
        if (Math.hypot(b.x - this.H.x, b.y - this.H.y) < 3.2) { this.dock(b); return; }
      }

      b.trailT += dt;
      if (b.trailT > 0.12) {
        b.trailT = 0;
        b.trail.push(b.x - Math.cos(b.h) * 1.4 * b.size, b.y - Math.sin(b.h) * 1.4 * b.size);
        if (b.trail.length > 30) b.trail.splice(0, 2);
      }
    }

    move(b, dt, windK) {
      b.x += Math.cos(b.h) * b.v * dt + this.wind[0] * windK * dt;
      b.y += Math.sin(b.h) * b.v * dt + this.wind[1] * windK * dt;
    }

    dock(b) {
      b.state = 'dock';
      b.slot = this.slots++;
      b.lit = false;
      const side = b.slot % 2 === 0 ? -1 : 1, row = b.slot >> 1;
      const off = 1.1 + 0.85 * b.size;
      b.dockA = { x: this.hx + side * (off + 0.8), y: this.pierTop - 1.3 };
      b.dockB = { x: this.hx + side * off, y: this.pierTop + 1.5 + row * 2.4 };
      b.dockPhase = 0;
      b.dockT = 0;
      this.homeCount++;
      const house = this.houses.find((h) => h.boat === b.id && !h.target);
      if (house) house.target = 1;
      this.emit('home', b);
    }

    updateDock(b, dt) {
      b.dockT += dt;
      b.hope = Math.min(1, b.hope + dt * 0.5);
      const tgt = b.dockPhase === 0 ? b.dockA : b.dockB;
      const dx = tgt.x - b.x, dy = tgt.y - b.y, d = Math.hypot(dx, dy);
      b.h += clamp(wrap(Math.atan2(dy, dx) - b.h), -2.6 * dt, 2.6 * dt);
      const vT = b.dockPhase === 0 ? 3 : Math.min(2.2, d * 0.9 + 0.3);
      b.v += (vT - b.v) * (1 - Math.exp(-dt * 2));
      b.x += Math.cos(b.h) * b.v * dt;
      b.y += Math.sin(b.h) * b.v * dt;
      if (b.trail.length) { b.trailT += dt; if (b.trailT > 0.2) { b.trailT = 0; b.trail.splice(0, 2); } }
      if (d < 0.7 || b.dockT > 9) {
        if (b.dockPhase === 0 && b.dockT < 9) b.dockPhase = 1;
        else { b.state = 'home'; b.x = b.dockB.x; b.y = b.dockB.y; b.h = Math.PI / 2; b.trail.length = 0; }
      }
    }

    blowHorn() {
      if (this.demo || !this.N.horn || this.horn.cd > 0 || this.done) return false;
      this.horn.cd = TUNE.hornCd;
      this.horn.at = this.t;
      for (const b of this.boats) {
        if (b.state === 'sea') { b.heard = TUNE.hornHeard; b.hope = Math.min(1, b.hope + 0.12); }
      }
      this.emit('horn');
      return true;
    }

    demoAim() {
      const t = this.t;
      this.aim.a = Math.sin(t * 0.21) * 1.15 + Math.sin(t * 0.53) * 0.12;
      this.aim.r = 78 + Math.sin(t * 0.17) * 26;
    }

    // Автопилот для проверок: светит на самую потерянную лодку и чуть вперёд по курсу.
    botAim() {
      const sea = this.boats.filter((b) => b.state === 'sea' && b.alpha > 0.3);
      if (!sea.length) return;
      let best = null, bs = 1e9;
      for (const b of sea) {
        const s = b.hope + (b.mem > 0.4 ? 0.6 : 0) + Math.hypot(b.x - this.lamp.x, b.y - this.lamp.y) / 400;
        if (s < bs) { bs = s; best = b; }
      }
      const tx = this.H.x - best.x, ty = this.H.y - best.y, td = Math.hypot(tx, ty) || 1;
      this.setAim(best.x + (tx / td) * 4, best.y + (ty / td) * 4);
      this.aim.r += 5;
      if (this.N.horn && this.horn.cd <= 0 && sea.filter((b) => b.hope < 0.45 && b.mem <= 0).length >= 2) this.blowHorn();
    }

    update(dt) {
      this.t += dt;
      this.horn.cd = Math.max(0, this.horn.cd - dt);
      this.updateBeam(dt);

      // Расписание: следующая лодка выходит по времени; если море пустое — не заставляем ждать.
      const active = this.boats.some((b) => b.state === 'sea' || b.state === 'gone');
      this.idle = active ? 0 : this.idle + dt;
      if (this.queue.length) {
        const nx = this.queue[0];
        if (nx.last) {
          if (this.queue.length === 1 && this.idle > 2.5) this.spawn(this.queue.shift());
        } else if (nx.t <= this.t) {
          this.spawn(this.queue.shift());
        } else if (!active && nx.t - this.t > 2) {
          const shift = nx.t - this.t - 2;
          for (const q of this.queue) if (!q.last) q.t -= shift;
        }
      }

      for (const r of this.rocks) {
        const lit = this.lightAt(r.x, r.y) > 0.25 || this.inBeam(r.x, r.y, r.r * 0.8);
        r.lit = lit ? 1 : 0;
        if (lit) r.reveal = 1;
        else r.reveal = Math.max(0, r.reveal - dt * TUNE.revealFade);
        for (const b of this.boats) {
          if (b.state !== 'sea') continue;
          if (Math.hypot(b.x - r.x, b.y - r.y) < r.r + 2 + 2.2 * b.hope) r.reveal = Math.max(r.reveal, 0.8);
        }
      }

      for (const b of this.boats) this.updateBoat(b, dt);
      for (const h of this.houses) h.lit += (h.target - h.lit) * (1 - Math.exp(-dt * 1.2));

      if (!this.demo && !this.done && !this.queue.length && this.boats.every((b) => b.state === 'home' || b.state === 'out')) {
        this.done = true;
        this.emit('done');
      }
    }
  }

  L.World = World;
})();
