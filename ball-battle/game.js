// Ball Battle Royale — 8 balls, ring territories, string-art fans, slow-motion kills.
// Deterministic sim driven frame by frame from Python (window.BB.frame()).
(function () {
  const W = 1080, H = 1920, FPS = 30, MICRO = 12, DT = 1 / (FPS * MICRO);
  const CX = 540, CY = 930, R0 = 470;
  const cfg = window.BB_CFG;
  let rng = mulberry(cfg.seed);
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = (a, b) => a + (b - a) * rng();

  const cv = document.getElementById('c'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  let R = R0;
  const CELLS = 720;                 // ring territory cells
  const owner = new Array(CELLS).fill(-1);
  const balls = [], dead = [], dying = [], particles = [], events = [];
  let frameNo = 0, simT = 0, stepNo = 0, ts = 1, killSteps = [], winner = null, winFrame = -1, banner = null;
  const HP = cfg.hp;

  const N = cfg.countries.length;
  const baseR = 54;
  const radiusFor = n => baseR * Math.pow(N / Math.max(n, 1), 0.28);

  // spawn evenly around the ring, each owning its arc
  cfg.countries.forEach((c, i) => {
    const a = -Math.PI / 2 - 2 * Math.PI / N + i * 2 * Math.PI / N;
    const d = R - baseR - 30;
    const dir = a + (rng() < 0.5 ? 1 : -1) * Math.PI / 2 + rnd(-0.6, 0.6);
    balls.push({ ...c, id: i, x: CX + Math.cos(a) * d, y: CY + Math.sin(a) * d,
      vx: Math.cos(dir), vy: Math.sin(dir), r: baseR, hp: HP, flash: 0, heal: 0, cd: {} });
    const c0 = Math.round(((a - Math.PI / N) / (2 * Math.PI)) * CELLS);
    for (let k = 0; k < CELLS / N; k++) owner[((c0 + k) % CELLS + CELLS) % CELLS] = i;
  });
  const byId = id => balls.find(b => b.id === id);

  function speed() { return cfg.speed * (balls.length <= 3 ? 1.25 : 1); }
  function norm(b, jit) {
    let ang = Math.atan2(b.vy, b.vx) + (jit ? rnd(-jit, jit) : 0);
    const s = speed(); b.vx = Math.cos(ang) * s; b.vy = Math.sin(ang) * s;
  }
  balls.forEach(b => norm(b));

  const cellOf = ang => ((Math.round(ang / (2 * Math.PI) * CELLS) % CELLS) + CELLS) % CELLS;

  function steer(dt) {
    // end game: nudge balls toward their nearest rival so duels resolve
    if (balls.length > 3) return;
    for (const b of balls) {
      let best = null, bd = 1e9;
      for (const o of balls) if (o !== b) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; best = o; } }
      if (!best) continue;
      const want = Math.atan2(best.y - b.y, best.x - b.x), cur = Math.atan2(b.vy, b.vx);
      const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      const ang = cur + Math.max(-1.2 * dt, Math.min(1.2 * dt, diff)), sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp;
    }
  }

  // ---------- physics ----------
  function step(dt) {
    steer(dt);
    for (const b of balls) { b.x += b.vx * dt; b.y += b.vy * dt; }
    for (const b of balls) {
      const dx = b.x - CX, dy = b.y - CY, d = Math.hypot(dx, dy);
      if (d + b.r <= R) continue;
      const nx = dx / d, ny = dy / d;
      b.x = CX + nx * (R - b.r); b.y = CY + ny * (R - b.r);
      const dot = b.vx * nx + b.vy * ny;
      if (dot <= 0) continue;
      b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; norm(b, 0.25);
      // claim territory around the impact; bouncing on your own turf heals
      const c = cellOf(Math.atan2(ny, nx));
      const mine = owner[c] === b.id;
      for (let k = -cfg.claim; k <= cfg.claim; k++) owner[(c + k + CELLS) % CELLS] = b.id;
      if (mine && b.hp < HP && balls.length > 3) {
        const h = Math.round(rnd(cfg.heal[0], cfg.heal[1]));
        b.hp = Math.min(HP, b.hp + h); b.heal = 1;
      }
    }
    for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d >= m || d === 0) continue;
      const nx = dx / d, ny = dy / d, ov = (m - d) / 2;
      a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
      const aT = a.vx * nx + a.vy * ny, bT = -(b.vx * nx + b.vy * ny);
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv >= 0) continue;
      a.vx += rv * nx; a.vy += rv * ny; b.vx -= rv * nx; b.vy -= rv * ny;
      norm(a, 0.15); norm(b, 0.15);
      const key = a.id * 100 + b.id;
      if (a.cd[key] > stepNo) continue;
      a.cd[key] = stepNo + 0.25 * FPS * MICRO;
      // the rammer deals the damage, the rammed ball takes it
      const [atk, vic, push] = aT >= bT ? [a, b, aT] : [b, a, bT];
      const dmg = Math.round(rnd(cfg.dmg[0], cfg.dmg[1]) + cfg.dmgPush * Math.max(0, push) / speed());
      vic.hp -= dmg; vic.flash = 1; vic.lastBy = atk.id;
      events.push({ f: frameNo, type: 'hit', v: Math.min(1, dmg / 25) });
      const px = a.x + nx * a.r, py = a.y + ny * a.r;
      for (let k = 0; k < 16; k++) spark(px, py, k % 2 ? atk.color : '#ffffff', 260, 0.5);
    }
  }

  function spark(x, y, color, sp, life) {
    const ang = rnd(0, Math.PI * 2), s = rnd(0.25, 1) * sp;
    particles.push({ x, y, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, life, max: life, color, size: rnd(1.5, 4) });
  }

  function kill(b) {
    balls.splice(balls.indexOf(b), 1);
    dead.push(b);
    dying.push({ b, t: 0 });
    const heir = balls.some(o => o.id === b.lastBy) ? b.lastBy : -1;
    for (let c = 0; c < CELLS; c++) if (owner[c] === b.id) owner[c] = heir;
    events.push({ f: frameNo, type: 'die', v: 1 });
    killSteps.push(stepNo);
    for (let k = 0; k < 60; k++) spark(b.x, b.y, k % 3 ? b.color : '#ffffff', 420, 0.9);
    banner = { text: fmt(cfg.t.out, b.name), color: b.color, until: simT + 2.2 };
  }

  // slow motion when a weak ball is about to be rammed
  function danger() {
    for (const v of balls) {
      if (v.hp > cfg.slowHp) continue;
      for (const o of balls) {
        if (o === v) continue;
        const dx = v.x - o.x, dy = v.y - o.y, d = Math.hypot(dx, dy);
        const closing = ((o.vx - v.vx) * dx + (o.vy - v.vy) * dy) / d;
        if (d - v.r - o.r < 110 && closing > 0) return true;
      }
    }
    return false;
  }

  // ---------- render ----------
  const imgs = {};
  function subtitle() {
    const n = balls.length;
    if (winner) return { text: fmt(cfg.t.wins, winner.name), color: winner.color };
    if (ts < 0.8) return { text: '● ' + cfg.t.slow, color: '#ff3b5c' };
    if (banner && simT < banner.until) return banner;
    if (n === 2) return { text: cfg.t.final, color: '#ffc83d' };
    if (n === 3) return { text: cfg.t.three, color: '#ffc83d' };
    if (n === 4) return { text: cfg.t.four, color: '#ffc83d' };
    return { text: cfg.t.comment, color: 'rgba(255,255,255,0.55)' };
  }

  function ringPt(c, rr) { const a = c / CELLS * 2 * Math.PI; return [CX + Math.cos(a) * rr, CY + Math.sin(a) * rr]; }

  function draw() {
    const g = ctx.createRadialGradient(CX, CY, 40, CX, CY, 1150);
    g.addColorStop(0, '#121826'); g.addColorStop(1, '#070a10');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // string-art fans: a line from each ball to every ring cell it owns
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.1;
    for (const b of balls) {
      ctx.strokeStyle = hexA(b.color, 0.5);
      ctx.beginPath();
      for (let c = 0; c < CELLS; c++) if (owner[c] === b.id) {
        const [x, y] = ringPt(c, R); ctx.moveTo(b.x, b.y); ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // ring: dotted, colored by owner
    for (let c = 0; c < CELLS; c++) {
      const o = owner[c], b = o >= 0 ? byId(o) : null;
      const col = b ? b.color : '#8a93a6';
      const [x, y] = ringPt(c, R);
      ctx.fillStyle = hexA(col, b ? 0.95 : 0.35);
      ctx.beginPath(); ctx.arc(x, y, b ? 3 : 2, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(CX, CY, R + 7, 0, 7); ctx.stroke(); ctx.restore();

    // dying balls: shrink inside a scope-like target
    for (const d of dying) {
      const k = d.t / 0.8, b = d.b;
      ctx.save();
      ctx.strokeStyle = hexA(b.color, 0.8 * (1 - k)); ctx.lineWidth = 2;
      for (const rr of [b.r * 1.6 + k * 60, b.r * 2.4 + k * 110]) { ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, 7); ctx.stroke(); }
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2 + k, r1 = b.r * 2.4 + k * 110;
        ctx.beginPath(); ctx.moveTo(b.x + Math.cos(a) * (r1 - 8), b.y + Math.sin(a) * (r1 - 8));
        ctx.lineTo(b.x + Math.cos(a) * (r1 + 8), b.y + Math.sin(a) * (r1 + 8)); ctx.stroke();
      }
      ctx.restore();
      drawBall(b, b.r * Math.max(0, 1 - k * 1.3), false);
    }

    for (const b of balls) drawBall(b, b.r * (1 + 0.1 * b.flash), !winner);

    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      ctx.fillStyle = hexA(p.color, Math.max(0, p.life / p.max));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // header
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#fff'; ctx.font = '900 76px Montserrat';
    ctx.fillText(cfg.t.title, CX, 330); ctx.restore();
    const s = subtitle();
    const quiet = s.color.startsWith('rgba');
    ctx.font = quiet ? '800 26px Montserrat' : '900 34px Montserrat';
    ctx.fillStyle = s.color;
    spaced(s.text.toUpperCase(), CX, 378, quiet ? 4 : 1);

    drawFooter();
  }

  function drawBall(b, r, label) {
    if (r <= 1) return;
    const k = b.flash;
    ctx.save();
    ctx.shadowColor = b.color; ctx.shadowBlur = 28 + 26 * k;
    ctx.strokeStyle = b.color; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(b.x, b.y, r + 2, 0, 7); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.clip();
    const im = imgs[b.code], ar = im.width / im.height;   // 4:3 flag, cover the circle
    ctx.drawImage(im, b.x - r * ar, b.y - r, 2 * r * ar, 2 * r);
    const sh = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.45, r * 0.05, b.x, b.y, r);
    sh.addColorStop(0, 'rgba(255,255,255,0.28)'); sh.addColorStop(0.55, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = sh; ctx.fillRect(b.x - r, b.y - r, 2 * r, 2 * r);
    if (k > 0) { ctx.fillStyle = `rgba(255,255,255,${0.5 * k})`; ctx.fillRect(b.x - r, b.y - r, 2 * r, 2 * r); }
    if (b.heal > 0) { ctx.fillStyle = `rgba(80,255,140,${0.35 * b.heal})`; ctx.fillRect(b.x - r, b.y - r, 2 * r, 2 * r); }
    ctx.restore();
    if (label) {
      ctx.font = '900 30px Montserrat'; ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const t = String(Math.max(0, Math.ceil(b.hp)));
      ctx.strokeText(t, b.x, b.y + r + 32);
      ctx.fillStyle = '#fff'; ctx.fillText(t, b.x, b.y + r + 32);
    }
  }

  function drawFooter() {
    const y = CY + R0 + 78, sz = 34, gap = 8;
    ctx.font = '900 30px Montserrat';
    const label = winner ? cfg.t.champion : fmt(cfg.t.left, balls.length);
    ctx.save(); ctx.letterSpacing = '2px';
    const tw = ctx.measureText(label).width; ctx.restore();
    const fw = dead.length ? dead.length * (sz + gap) + 6 : 0;
    let x = CX - (fw + tw) / 2;
    for (const b of dead) {
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(x + sz / 2, y - 11, sz / 2, 0, 7); ctx.clip();
      const im = imgs[b.code], ar = im.width / im.height;
      ctx.drawImage(im, x + sz / 2 - sz / 2 * ar, y - 11 - sz / 2, sz * ar, sz);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, y - 11 - sz / 2, sz, sz);
      ctx.restore();
      x += sz + gap;
    }
    if (dead.length) x += 6;
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
    spaced(label, x, y, 2);
    ctx.textAlign = 'center';
  }

  function spaced(text, x, y, sp) { ctx.save(); ctx.letterSpacing = sp + 'px'; ctx.fillText(text, x, y); ctx.restore(); }
  function fmt(t, v) { return t.replace('{}', v); }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

  // ---------- frame driver ----------
  function update() {
    // slow motion around kills known from the first (preview) pass
    const pre = 0.75 * FPS * MICRO, post = 0.3 * FPS * MICRO;
    const near = (cfg.slowAt || []).some(k => stepNo > k - pre && stepNo < k + post);
    ts += ((!winner && near ? cfg.slowFactor : 1) - ts) * 0.3;
    const nSteps = winner ? MICRO : Math.max(2, Math.round(MICRO * ts));
    const dtF = nSteps * DT;
    if (!winner) {
      for (let s = 0; s < nSteps; s++) {
        if (balls.length <= 2) R = Math.max(330, R - 0.5 / MICRO);
        step(DT); stepNo++;
        for (const b of balls.filter(b => b.hp <= 0).sort((a, b) => a.hp - b.hp)) if (balls.length > 1) kill(b);
        for (const b of balls) if (b.hp <= 0) b.hp = 1;
        const tr = radiusFor(balls.length);
        for (const b of balls) b.r += (tr - b.r) * (0.03 / MICRO);
        if (balls.length === 1) break;
      }
      if (balls.length === 1) { winner = balls[0]; winFrame = frameNo; events.push({ f: frameNo, type: 'win', v: 1 }); }
    } else {
      const w = winner;
      w.x += (CX - w.x) * 0.07; w.y += (CY - w.y) * 0.07; w.r += (120 - w.r) * 0.07;
      // winner takes the whole ring
      for (let c = 0; c < CELLS; c++) if (owner[c] !== w.id && rng() < 0.08) owner[c] = w.id;
      if ((frameNo - winFrame) % 5 === 0) for (let k = 0; k < 12; k++) {
        const cols = [w.color, '#ffd23f', '#ffffff', '#ff4d8d', '#3ddcff'];
        spark(CX + rnd(-420, 420), CY - R + rnd(0, 80), cols[k % 5], 200, 1.6);
      }
    }
    for (const b of balls) { b.flash = Math.max(0, b.flash - 0.1 * ts - 0.02); b.heal = Math.max(0, b.heal - 0.08); }
    for (const p of particles) { p.x += p.vx * dtF; p.y += p.vy * dtF; p.vx *= 0.95; p.vy *= 0.95; if (winner) p.vy += 8; p.life -= dtF; }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    for (const d of dying) d.t += dtF;
    for (let i = dying.length - 1; i >= 0; i--) if (dying[i].t > 0.8) dying.splice(i, 1);
    simT += dtF;
    frameNo++;
  }

  window.BB = {
    async init() {
      await document.fonts.load('900 40px Montserrat');
      await document.fonts.load('800 26px Montserrat');
      await Promise.all(cfg.countries.map(c => new Promise(res => {
        const im = new Image(); im.onload = res; im.src = c.flag; imgs[c.code] = im;
      })));
    },
    frame(render) { update(); if (render) draw(); return { done: !!winner && frameNo - winFrame > cfg.holdEnd * FPS, frame: frameNo }; },
    shot() { return cv.toDataURL('image/jpeg', 0.92); },
    events() { return events; },
    killSteps() { return killSteps; },
    summary() { return { winner: winner && winner.name, deaths: dead.map(d => d.name) }; },
  };
})();
