// Рисование ночи. Один цвет: всё — оттенки света на чёрном (к рассвету — наоборот).
(function () {
  'use strict';
  const L = window.L;
  const { TAU, clamp, sstep, mulberry } = L.util;
  const R = (L.render = {});

  let cv, ctx, W = 0, H = 0, dpr = 1, s = 1, ox = 0, oy = 0;
  let fogTex, grainTex, fogPat, grainPat, vign = null;
  let waves = [], waveKey = '', stipple = [], stippleKey = '';
  let frame = 0, grainX = 0, grainY = 0;
  const FONT = '"Cormorant Garamond", "Cormorant", Georgia, serif';
  const BOAT = 1.22; // лодки рисуются чуть крупнее своего физического круга — так их легче читать

  R.init = function (canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    fogTex = makeFog();
    grainTex = makeGrain(false);
    R.resize();
  };

  R.resize = function () {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    fogPat = ctx.createPattern(fogTex, 'repeat');
    grainPat = ctx.createPattern(grainTex, 'repeat');
    vign = null;
    waveKey = '';
  };

  R.size = () => ({ W, H });
  R.view = function (w) {
    s = Math.min(W / w.ww, H / w.wh);
    ox = (W - w.ww * s) / 2;
    oy = (H - w.wh * s) / 2;
  };
  R.toWorld = (px, py) => ({ x: (px - ox) / s, y: (py - oy) / s });
  R.toScreen = (x, y) => ({ x: x * s + ox, y: y * s + oy });
  R.canvas = () => cv;

  // ---------- текстуры ----------
  function makeFog() {
    const N = 128, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    const octs = [[4, 0.55], [8, 0.3], [16, 0.15]];
    const grids = octs.map(([f], k) => { const r = mulberry(91 + k * 17); return Array.from({ length: f * f }, r); });
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let v = 0;
        octs.forEach(([f, amp], k) => {
          const G = grids[k], gx = (x / N) * f, gy = (y / N) * f;
          const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
          const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
          const at = (i, j) => G[(j % f) * f + (i % f)];
          v += amp * ((at(x0, y0) * (1 - u) + at(x0 + 1, y0) * u) * (1 - w) + (at(x0, y0 + 1) * (1 - u) + at(x0 + 1, y0 + 1) * u) * w);
        });
        const a = Math.pow(sstep(0.32, 0.86, v), 1.3);
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 236;
        img.data[i + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function makeGrain(dark) {
    const N = 160, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), r = mulberry(dark ? 7 : 5);
    for (let i = 0; i < N * N; i++) {
      const v = r();
      const p = i * 4, col = dark ? 20 : 240;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = col;
      img.data[p + 3] = v < 0.55 ? v * (dark ? 34 : 48) : 0;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  R.paperGrainURL = function () { return makeGrain(true).toDataURL(); };

  function ensureWaves(x0, y0, x1, y1) {
    const key = [x0, y0, x1, y1].map((v) => Math.round(v)).join(',');
    if (key === waveKey) return;
    waveKey = key;
    const r = mulberry(1234), area = (x1 - x0) * (y1 - y0);
    const n = Math.min(1800, Math.round(area / 13));
    waves = [];
    for (let i = 0; i < n; i++) {
      waves.push({ x: x0 + r() * (x1 - x0), y: y0 + r() * (y1 - y0), l: 0.9 + r() * 1.8, ph: r() * TAU, sp: 0.6 + r() * 0.8 });
    }
  }

  function ensureStipple(w, x0, x1, y1) {
    const key = w.n + ':' + Math.round(x0) + ',' + Math.round(x1) + ',' + Math.round(y1) + ':' + w.ww.toFixed(1);
    if (key === stippleKey) return;
    stippleKey = key;
    const r = mulberry(77 + w.n);
    stipple = [];
    const n = Math.round((x1 - x0) * 3.2);
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0);
      const cy = w.coastY(x);
      const y = cy + 1 + r() * Math.max(1, y1 - cy);
      stipple.push(x, y, r());
    }
  }

  // ---------- палитра одного цвета ----------
  // dawn 0 — ночь (свет на чёрном), 1 — утро (чернила на бумаге).
  let BG = 11, FG = 240, LAND = 21;
  const mix = (a, b, t) => a + (b - a) * t;
  function fg(a) { return `rgba(${FG | 0},${FG | 0},${FG | 0},${clamp(a, 0, 1).toFixed(3)})`; }
  function gray(v, a) { v = v | 0; return a == null ? `rgb(${v},${v},${v})` : `rgba(${v},${v},${v},${a})`; }

  function boatPath(size) {
    const p = new Path2D(), k = size;
    p.moveTo(1.65 * k, 0);
    p.bezierCurveTo(0.9 * k, -0.74 * k, -0.7 * k, -0.7 * k, -1.5 * k, -0.5 * k);
    p.quadraticCurveTo(-1.72 * k, 0, -1.5 * k, 0.5 * k);
    p.bezierCurveTo(-0.7 * k, 0.7 * k, 0.9 * k, 0.74 * k, 1.65 * k, 0);
    return p;
  }
  const hulls = {};
  const hull = (size) => hulls[size] || (hulls[size] = boatPath(size));

  // Имя, которое частично угасает: первые буквы ровные, хвост тлеет и медленно дышит, как догорающий огонёк.
  function fadeText(str, cx, y, alpha, t) {
    const chars = [...str], n = chars.length;
    const widths = chars.map((c) => ctx.measureText(c).width);
    let x = cx - widths.reduce((sum, v) => sum + v, 0) / 2;
    const align = ctx.textAlign;
    ctx.textAlign = 'left';
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0;
      const breath = 0.5 + 0.5 * Math.sin(t * 0.9 - i * 0.7);
      const keep = 1 - sstep(0.15, 0.95, k) * (0.7 + 0.28 * breath);
      ctx.fillStyle = fg(alpha * keep);
      ctx.fillText(chars[i], x, y);
      x += widths[i];
    }
    ctx.textAlign = align;
  }

  function lanternLight(w, x, y) {
    let v = 0;
    for (const b of w.boats) {
      if (b.state === 'out' || b.alpha <= 0) continue;
      const rad = 2.2 + 2.6 * b.hope;
      const d2 = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d2 < rad * rad) v += (1 - Math.sqrt(d2) / rad) * 0.45 * b.hope * b.alpha;
    }
    return v;
  }

  // ---------- кадр ----------
  R.draw = function (w, opt) {
    opt = opt || {};
    frame++;
    R.view(w);
    const t = w.t, px = 1 / s;
    const dawn = opt.dawn || 0;
    const turn = sstep(0.18, 0.62, dawn);
    BG = mix(11, 214, sstep(0, 0.75, dawn));
    FG = mix(240, 24, turn);
    LAND = mix(21, 196, sstep(0, 0.75, dawn));
    const night = 1 - turn;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = gray(BG);
    ctx.fillRect(0, 0, W, H);

    const x0 = -ox / s - 2, x1 = (W - ox) / s + 2, y0 = -oy / s - 2, y1 = (H - oy) / s + 2;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // земля
    const coast = new Path2D();
    coast.moveTo(x0, w.coastY(x0));
    for (let x = x0; x <= x1 + 0.7; x += 0.7) coast.lineTo(x, w.coastY(x));
    const land = new Path2D(coast);
    land.lineTo(x1 + 1, y1 + 1);
    land.lineTo(x0 - 1, y1 + 1);
    land.closePath();
    ctx.fillStyle = gray(LAND);
    ctx.fill(land);
    ensureStipple(w, x0, x1, y1);
    ctx.fillStyle = fg(0.09);
    for (let i = 0; i < stipple.length; i += 3) {
      const r = 0.1 + stipple[i + 2] * 0.12;
      ctx.fillRect(stipple[i] - r, stipple[i + 1] - r, r * 2, r * 2);
    }

    // волны: тусклые везде, яркие в луче
    ensureWaves(x0, y0, x1, y1);
    const bins = 10, paths = [];
    for (let i = 0; i < bins; i++) paths.push(new Path2D());
    const ww = x1 - x0, drift = t * 0.6 * (w.wind[0] >= 0 ? 1 : -1);
    for (const wv of waves) {
      let x = wv.x + drift * wv.sp;
      x = x0 + ((((x - x0) % ww) + ww) % ww);
      const y = wv.y + Math.sin(t * 0.4 + wv.ph) * 0.3;
      if (y > w.coastY(x) - 0.9) continue;
      const shim = 0.5 + 0.5 * Math.sin(t * 0.7 * wv.sp + wv.ph);
      const lit = Math.min(1, w.lightAt(x, y) + lanternLight(w, x, y));
      const a = (0.05 + 0.62 * lit) * (0.35 + 0.65 * shim);
      const bi = Math.min(bins - 1, Math.floor(a * 1.4 * bins));
      if (bi <= 0 && a < 0.025) continue;
      const p = paths[bi], l = wv.l;
      p.moveTo(x - l / 2, y);
      p.quadraticCurveTo(x, y - l * 0.3, x + l / 2, y);
    }
    ctx.lineWidth = 1.1 * px;
    for (let i = 0; i < bins; i++) {
      ctx.strokeStyle = fg(((i + 0.5) / bins) / 1.4);
      ctx.stroke(paths[i]);
    }

    // береговая линия и пена
    ctx.strokeStyle = fg(0.3);
    ctx.lineWidth = 1.2 * px;
    ctx.stroke(coast);
    ctx.save();
    ctx.translate(0, -0.9);
    ctx.setLineDash([0.5, 1.6]);
    ctx.lineDashOffset = opt.reduced ? 0 : -t * 0.5;
    ctx.strokeStyle = fg(0.13);
    ctx.stroke(coast);
    ctx.restore();
    ctx.setLineDash([]);

    // причал
    const pb = w.coastY(w.hx) + 1;
    ctx.fillStyle = gray(LAND);
    ctx.fillRect(w.hx - 0.55, w.pierTop, 1.1, pb - w.pierTop);
    ctx.strokeStyle = fg(0.42);
    ctx.lineWidth = 1.1 * px;
    ctx.strokeRect(w.hx - 0.55, w.pierTop, 1.1, pb - w.pierTop);
    ctx.strokeStyle = fg(0.16);
    ctx.beginPath();
    for (let y = w.pierTop + 0.7; y < pb; y += 0.7) { ctx.moveTo(w.hx - 0.55, y); ctx.lineTo(w.hx + 0.55, y); }
    ctx.stroke();

    // дома
    for (const h of w.houses) {
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(h.rot);
      const hw = h.s * 0.66, hh = h.s * 0.44;
      ctx.fillStyle = gray(mix(LAND, FG, 0.04 + 0.1 * h.lit * night));
      ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
      ctx.strokeStyle = fg(0.22 + 0.5 * h.lit);
      ctx.lineWidth = 1 * px;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctx.beginPath();
      ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0);
      ctx.stroke();
      ctx.strokeRect(hw * 0.38, -hh * 0.78, hw * 0.24, hh * 0.42);
      ctx.restore();
    }

    // скалы — видны, пока на них свет, и ещё немного после
    for (const r of w.rocks) {
      const vis = Math.max(r.reveal * 0.72, w.lightAt(r.x, r.y) * 1.1);
      if (vis < 0.01) continue;
      ctx.save();
      ctx.translate(r.x, r.y);
      const p = new Path2D();
      p.moveTo(r.pts[0], r.pts[1]);
      for (let i = 2; i < r.pts.length; i += 2) p.lineTo(r.pts[i], r.pts[i + 1]);
      p.closePath();
      ctx.fillStyle = gray(BG);
      ctx.fill(p);
      ctx.save();
      ctx.clip(p);
      ctx.strokeStyle = fg(vis * 0.28);
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      for (let k = -r.r * 2; k < r.r * 2; k += 0.85) { ctx.moveTo(k, -r.r); ctx.lineTo(k + r.r, r.r); }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = fg(vis * 0.9);
      ctx.lineWidth = 1.3 * px;
      ctx.stroke(p);
      ctx.setLineDash([0.4, 1]);
      ctx.lineDashOffset = opt.reduced ? 0 : t * 0.3;
      ctx.strokeStyle = fg(vis * 0.22);
      ctx.beginPath();
      ctx.arc(0, 0, r.r * 1.12 + 0.35 + Math.sin(t * 0.9 + r.ph) * 0.18, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // лодки: след, корпус
    for (const b of w.boats) {
      if (b.state === 'out' || b.alpha <= 0.01) continue;
      const lit = Math.min(1, w.lightAt(b.x, b.y) + (b.lit ? 0.4 : 0));
      if (b.trail.length > 4) {
        const n = b.trail.length;
        for (let k = 0; k < 4; k++) {
          const a0 = Math.floor((k / 4) * n / 2) * 2, a1 = Math.min(n, Math.floor(((k + 1) / 4) * n / 2) * 2 + 2);
          ctx.beginPath();
          ctx.moveTo(b.trail[a0], b.trail[a0 + 1]);
          for (let i = a0 + 2; i < a1; i += 2) ctx.lineTo(b.trail[i], b.trail[i + 1]);
          ctx.strokeStyle = fg(b.alpha * (0.04 + 0.2 * lit) * ((k + 1) / 4));
          ctx.lineWidth = 1 * px;
          ctx.stroke();
        }
      }
      let h = b.h;
      if (b.state === 'home') h = Math.PI / 2 + Math.sin(t * 1.3 + b.bob) * 0.035;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(h);
      const p = hull(b.size * BOAT);
      ctx.fillStyle = gray(BG);
      ctx.globalAlpha = b.alpha;
      ctx.fill(p);
      ctx.strokeStyle = fg(0.38 + 0.62 * Math.max(lit, b.state === 'home' ? 0.25 : 0));
      ctx.lineWidth = 1.25 * px;
      ctx.stroke(p);
      ctx.strokeStyle = fg(0.3 + 0.4 * lit);
      const z = b.size * BOAT;
      ctx.beginPath();
      ctx.moveTo(0.25 * z, -0.5 * z); ctx.lineTo(0.25 * z, 0.5 * z);
      ctx.moveTo(-0.7 * z, -0.46 * z); ctx.lineTo(-0.7 * z, 0.46 * z);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // маяк
    const lp = w.lamp;
    ctx.fillStyle = gray(LAND);
    ctx.beginPath(); ctx.arc(lp.x, lp.y, 2.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = fg(0.35); ctx.lineWidth = 1 * px; ctx.stroke();
    ctx.fillStyle = gray(mix(BG, FG, 0.08));
    ctx.beginPath(); ctx.arc(lp.x, lp.y, 1.55, 0, TAU); ctx.fill();
    ctx.strokeStyle = fg(0.75); ctx.lineWidth = 1.3 * px; ctx.stroke();
    ctx.setLineDash([0.25, 0.45]);
    ctx.strokeStyle = fg(0.45);
    ctx.beginPath(); ctx.arc(lp.x, lp.y, 2.05, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // кольца ревуна
    for (let k = 0; k < 3; k++) {
      const age = t - w.horn.at - k * 0.38;
      if (age <= 0 || age > 3.2) continue;
      ctx.strokeStyle = fg((1 - age / 3.2) * 0.32 * night);
      ctx.lineWidth = 1.2 * px;
      ctx.beginPath(); ctx.arc(lp.x, lp.y, 3 + age * 24, 0, TAU); ctx.stroke();
    }

    // туман
    const fogA = w.fog * (1 - 0.6 * dawn);
    if (fogA > 0.005) {
      fogPat.setTransform(new DOMMatrix().translateSelf(13 + t * 0.9, 41 + t * 0.22).rotateSelf(17).scaleSelf(0.96));
      ctx.fillStyle = fogPat;
      ctx.globalAlpha = fogA * 0.5;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      fogPat.setTransform(new DOMMatrix().translateSelf(-t * 0.5, t * 0.12).rotateSelf(-23).scaleSelf(1.7));
      ctx.globalAlpha = fogA * 0.45;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1;
    }

    // луч
    const B = w.beam, beamA = B.on * (1 - sstep(0.05, 0.6, dawn));
    if (beamA > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, B.r * 1.08);
      grad.addColorStop(0, 'rgba(255,255,255,0.34)');
      grad.addColorStop(0.12, 'rgba(255,255,255,0.17)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.075)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      const cone = (ha) => {
        const p = new Path2D();
        p.moveTo(lp.x, lp.y);
        p.arc(lp.x, lp.y, B.r * 1.08, B.a - ha - Math.PI / 2, B.a + ha - Math.PI / 2);
        p.closePath();
        return p;
      };
      const layers = [[1.5, 0.22], [1.2, 0.4], [1.0, 0.62], [0.55, 0.45]];
      for (const [k, a] of layers) { ctx.globalAlpha = a * beamA; ctx.fill(cone(B.ha * k)); }
      // туман в луче светится
      if (fogA > 0.005) {
        ctx.save();
        ctx.clip(cone(B.ha * 1.1));
        fogPat.setTransform(new DOMMatrix().translateSelf(13 + t * 0.9, 41 + t * 0.22).rotateSelf(17).scaleSelf(0.96));
        ctx.fillStyle = fogPat;
        ctx.globalAlpha = Math.min(1, fogA * 1.3) * beamA * 0.5;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // огни: фонарь маяка, причал, окна, огоньки лодок — пробивают туман
    ctx.globalCompositeOperation = night > 0.5 ? 'lighter' : 'source-over';
    const glow = (x, y, r, a) => {
      if (a <= 0.004) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, fg(a));
      g.addColorStop(0.35, fg(a * 0.35));
      g.addColorStop(1, fg(0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    glow(lp.x, lp.y, 9, 0.38 * B.on * night);
    ctx.fillStyle = fg(0.35 + 0.65 * B.on);
    ctx.beginPath(); ctx.arc(lp.x, lp.y, 0.6, 0, TAU); ctx.fill();
    const pulse = 0.75 + 0.25 * Math.sin(t * 1.6);
    glow(w.hx, w.pierTop + 0.35, 3.2, 0.32 * pulse * night);
    ctx.fillStyle = fg(0.9 * night + 0.1);
    ctx.beginPath(); ctx.arc(w.hx, w.pierTop + 0.35, 0.22, 0, TAU); ctx.fill();
    for (const h of w.houses) {
      if (h.lit < 0.02) continue;
      glow(h.x, h.y + h.s * 0.3, 4.4 * h.s, 0.3 * h.lit * night);
      ctx.save();
      ctx.translate(h.x, h.y); ctx.rotate(h.rot);
      const hw = h.s * 0.66, hh = h.s * 0.44;
      // свет из окон ложится на землю у стен
      ctx.fillStyle = fg(0.22 * h.lit);
      ctx.fillRect(-hw * 0.62, hh, hw * 0.34, 0.75);
      ctx.fillRect(hw * 0.12, hh, hw * 0.34, 0.75);
      ctx.fillStyle = fg(0.9 * h.lit);
      ctx.fillRect(-hw * 0.62, hh - 0.1, hw * 0.34, 0.24);
      ctx.fillRect(hw * 0.12, hh - 0.1, hw * 0.34, 0.24);
      ctx.fillRect(-hw - 0.12, -hh * 0.3, 0.24, hh * 0.6);
      ctx.restore();
    }
    for (const b of w.boats) {
      if (b.state === 'out' || b.alpha <= 0.01) continue;
      let h = b.state === 'home' ? Math.PI / 2 : b.h;
      const lx = b.x - Math.cos(h) * 1.05 * b.size * BOAT, ly = b.y - Math.sin(h) * 1.05 * b.size * BOAT;
      let flick = 0.9 + 0.1 * Math.sin(t * 7.3 + b.bob) * Math.sin(t * 3.1 + b.seed);
      if (b.state === 'sea' && b.hope < 0.3) flick *= 0.55 + 0.45 * Math.abs(Math.sin(t * 5));
      const k = b.alpha * flick * (b.state === 'home' ? 0.75 : 0.35 + 0.65 * b.hope);
      glow(lx, ly, 1 + 3 * Math.max(0.2, b.hope), 0.42 * k * night);
      ctx.fillStyle = fg(k);
      ctx.beginPath(); ctx.arc(lx, ly, 0.32, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // подписи лодок в луче
    const fs = 15 * px;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `italic 500 ${fs}px ${FONT}`;
    for (const b of w.boats) {
      if (b.state !== 'sea' || b.labelA < 0.02) continue;
      const txt = b.plain ? b.name : `«${b.name}»`, ty = b.y + 2.2 * b.size + 0.4, ta = 0.72 * b.labelA * b.alpha;
      if (b.fade) fadeText(txt, b.x, ty, ta, t);
      else { ctx.fillStyle = fg(ta); ctx.fillText(txt, b.x, ty); }
    }
    // всплывающие надписи у причала
    if (opt.fx) {
      ctx.textBaseline = 'alphabetic';
      ctx.font = `italic 500 ${17 * px}px ${FONT}`;
      for (const f of opt.fx) {
        const age = t - f.t0;
        if (age < 0 || age > 3.4) continue;
        const a = sstep(0, 0.4, age) * (1 - sstep(2.2, 3.4, age));
        if (f.fade) fadeText(f.text, f.x, f.y - 2 - age * 1.6, a * 0.9, t);
        else { ctx.fillStyle = fg(a * 0.9); ctx.fillText(f.text, f.x, f.y - 2 - age * 1.6); }
      }
    }

    // прицел мыши
    if (opt.cursor) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = fg(0.55 * night);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(opt.cursor.x, opt.cursor.y, 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = fg(0.8 * night);
      ctx.fillRect(opt.cursor.x - 1, opt.cursor.y - 1, 2, 2);
    }

    // виньетка и зерно
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!vign) {
      vign = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.35, W / 2, H * 0.48, Math.hypot(W, H) * 0.62);
      vign.addColorStop(0, 'rgba(0,0,0,0)');
      vign.addColorStop(1, 'rgba(0,0,0,0.6)');
    }
    ctx.globalAlpha = night;
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, W, H);
    if (!opt.reduced && frame % 3 === 0) { grainX = Math.random() * 160; grainY = Math.random() * 160; }
    grainPat.setTransform(new DOMMatrix().translateSelf(grainX, grainY));
    ctx.globalAlpha = 0.6 * night;
    ctx.fillStyle = grainPat;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    // рассвет переходит в бумагу дневника
    const paper = sstep(0.6, 1, dawn);
    if (paper > 0) {
      ctx.fillStyle = `rgba(241,241,238,${paper.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  };
})();
