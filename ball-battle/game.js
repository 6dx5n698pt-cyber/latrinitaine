// Ball Battle Royale — deterministic sim + canvas renderer.
// Driven frame by frame from Python (window.BB.frame()).
(function () {
  const W = 1080, H = 1920, FPS = 30, SUB = 4;
  const CX = 540, CY = 1000;
  const cfg = window.BB_CFG;
  let rng = mulberry(cfg.seed);
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = (a, b) => a + (b - a) * rng();

  const cv = document.getElementById('c'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  let R = 470;            // arena radius (shrinks in the end game)
  const SPEED = cfg.speed; // px per second
  const balls = [];
  const dead = [];
  const particles = [];
  const rings = [];
  const events = [];      // audio events {f, type, v}
  let frameNo = 0, winner = null, winFrame = -1, banner = null;

  function targetRadius(n) { return Math.min(92, 33 * Math.sqrt(32 / Math.max(n, 1))); }

  // spawn
  const n0 = cfg.countries.length;
  const order = cfg.countries.map(c => [rng(), c]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  for (const c of order) {
    const r = targetRadius(n0);
    let x, y, ok, tries = 0;
    do {
      const a = rnd(0, Math.PI * 2), d = Math.sqrt(rng()) * (R - r - 6);
      x = CX + Math.cos(a) * d; y = CY + Math.sin(a) * d;
      ok = balls.every(b => Math.hypot(b.x - x, b.y - y) > b.r + r + 4);
    } while (!ok && ++tries < 2000);
    const a = rnd(0, Math.PI * 2);
    balls.push({ ...c, x, y, vx: Math.cos(a) * SPEED, vy: Math.sin(a) * SPEED, r, hp: cfg.hp, hits: [], flash: 0, cd: {} });
  }

  // ---- physics ----
  function step(dt) {
    const alive = balls;
    for (const b of alive) { b.x += b.vx * dt; b.y += b.vy * dt; }
    // wall
    for (const b of alive) {
      const dx = b.x - CX, dy = b.y - CY, d = Math.hypot(dx, dy);
      if (d + b.r > R) {
        const nx = dx / d, ny = dy / d;
        b.x = CX + nx * (R - b.r); b.y = CY + ny * (R - b.r);
        const dot = b.vx * nx + b.vy * ny;
        if (dot > 0) {
          b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
          jitter(b, 0.12);
          b.hits.push(Math.atan2(ny, nx));
          if (b.hits.length > 46) b.hits.shift();
        }
      }
    }
    // ball-ball
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d >= m || d === 0) continue;
      const nx = dx / d, ny = dy / d, ov = (m - d) / 2;
      a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        a.vx += rv * nx; a.vy += rv * ny; b.vx -= rv * nx; b.vy -= rv * ny;
        jitter(a, 0.1); jitter(b, 0.1);
        const key = a.code + b.code;
        if (!(a.cd[key] > frameNo)) {
          a.cd[key] = frameNo + 6;
          hit(a, b, a.x + nx * a.r, a.y + ny * a.r);
        }
      }
    }
  }
  function jitter(b, amt) {
    let ang = Math.atan2(b.vy, b.vx) + rnd(-amt, amt);
    const s = SPEED * (1 + 0.25 * endBoost());
    b.vx = Math.cos(ang) * s; b.vy = Math.sin(ang) * s;
  }
  function steer() {
    // in the end game, nudge each ball toward its nearest rival so duels don't stall
    if (balls.length > 3) return;
    for (const b of balls) {
      let best = null, bd = 1e9;
      for (const o of balls) if (o !== b) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; best = o; } }
      if (!best) continue;
      const want = Math.atan2(best.y - b.y, best.x - b.x), cur = Math.atan2(b.vy, b.vx);
      let diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      const ang = cur + Math.max(-0.02, Math.min(0.02, diff)), sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp;
    }
  }
  function endBoost() { return balls.length <= 3 ? 1 : 0; }

  function dmgMult() {
    // damage ramps up over time so a video never drags on
    const t = frameNo / FPS;
    return 1 + Math.max(0, t - cfg.rampAfter) * 0.06;
  }
  function hit(a, b, x, y) {
    const roll = () => Math.round(rnd(cfg.dmg[0], cfg.dmg[1]) * (rng() < cfg.crit ? 5 : 1) * dmgMult());
    const da = roll(), db = roll();
    a.hp -= da; b.hp -= db; a.flash = 1; b.flash = 1;
    events.push({ f: frameNo, type: 'hit', v: Math.min(1, (da + db) / 30) });
    for (let k = 0; k < 10; k++) spark(x, y, k % 2 ? a.color : b.color, 160, 0.35);
  }
  function spark(x, y, color, sp, life) {
    const ang = rnd(0, Math.PI * 2), s = rnd(0.3, 1) * sp;
    particles.push({ x, y, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, life, max: life, color, size: rnd(2, 5) });
  }
  function kill(b) {
    balls.splice(balls.indexOf(b), 1);
    dead.push(b);
    events.push({ f: frameNo, type: 'die', v: 1 });
    for (let k = 0; k < 70; k++) spark(b.x, b.y, k % 3 ? b.color : '#ffffff', 520, 0.9);
    rings.push({ x: b.x, y: b.y, r: b.r, life: 0.6, max: 0.6, color: b.color });
    const n = balls.length;
    let sub = fmt(cfg.t.out, b.name);
    banner = { text: sub, color: b.color, until: frameNo + 45 };
  }

  // ---- render ----
  const imgs = {};
  function flagImg(code) { return imgs[code]; }

  function subtitle() {
    const n = balls.length;
    if (winner) return { text: cfg.t.winner, color: winner.color };
    if (banner && frameNo < banner.until) return banner;
    if (n === 2) return { text: cfg.t.final, color: '#ffd23f' };
    if (n === 3) return { text: cfg.t.three, color: '#ffd23f' };
    if (n === 4) return { text: cfg.t.four, color: '#ffd23f' };
    return { text: cfg.t.comment, color: 'rgba(255,255,255,0.55)' };
  }

  function draw() {
    // background
    const g = ctx.createRadialGradient(CX, CY, 50, CX, CY, 1100);
    g.addColorStop(0, '#141a26'); g.addColorStop(1, '#07090e');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // string-art fans
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.4;
    const all = winner ? [winner] : balls;
    for (const b of all) {
      const n = all.length, keep = n > 12 ? 10 : n > 5 ? 22 : 46;
      const hs = b.hits.slice(-keep);
      ctx.strokeStyle = hexA(b.color, Math.min(0.45, 0.16 * Math.sqrt(16 / n)));
      ctx.beginPath();
      for (const a of hs) { ctx.moveTo(b.x, b.y); ctx.lineTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R); }
      ctx.stroke();
      // colored arc tick at wall
      ctx.fillStyle = hexA(b.color, 0.8);
      for (const a of hs) { ctx.beginPath(); ctx.arc(CX + Math.cos(a) * R, CY + Math.sin(a) * R, 2.2, 0, 7); ctx.fill(); }
    }
    ctx.globalCompositeOperation = 'source-over';

    // arena ring
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 18;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // shockwave rings
    for (const r of rings) {
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = hexA(r.color, 1 - k); ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r + k * 160, 0, 7); ctx.stroke();
    }

    // balls
    for (const b of all) drawBall(b);

    // particles
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      ctx.fillStyle = hexA(p.color, Math.max(0, p.life / p.max));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // header
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff'; ctx.font = '900 92px Montserrat';
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 20;
    ctx.fillText(cfg.t.title, CX, 330); ctx.restore();
    const s = subtitle();
    ctx.font = '900 40px Montserrat'; ctx.fillStyle = s.color;
    spaced(s.text.toUpperCase(), CX, 390, 3);

    // footer: eliminated flags + N LEFT
    drawFooter();

    if (winner) drawWinner();
  }

  function drawBall(b) {
    const k = b.flash, r = b.r * (1 + 0.12 * k);
    ctx.save();
    ctx.shadowColor = b.color; ctx.shadowBlur = 30 + 30 * k;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, r + 3, 0, 7); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.clip();
    ctx.drawImage(flagImg(b.code), b.x - r, b.y - r, 2 * r, 2 * r);
    // glossy shading
    const sh = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
    sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = sh; ctx.fillRect(b.x - r, b.y - r, 2 * r, 2 * r);
    if (k > 0) { ctx.fillStyle = `rgba(255,255,255,${0.45 * k})`; ctx.fillRect(b.x - r, b.y - r, 2 * r, 2 * r); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.stroke();
    if (!winner) {
      const fs = Math.round(Math.max(24, r * 0.55));
      ctx.font = `900 ${fs}px Montserrat`; ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const hp = String(Math.max(0, Math.ceil(b.hp)));
      ctx.strokeText(hp, b.x, b.y + r + fs + 2);
      ctx.fillStyle = '#fff'; ctx.fillText(hp, b.x, b.y + r + fs + 2);
    }
  }

  function drawFooter() {
    const top = CY + R + 60, sz = 44, gap = 8, perRow = 16;
    const rows = [];
    for (let i = 0; i < dead.length; i += perRow) rows.push(dead.slice(i, i + perRow));
    rows.forEach((row, ri) => {
      const w = row.length * (sz + gap) - gap;
      let x = CX - w / 2 + sz / 2;
      const y = top + ri * (sz + gap);
      for (const b of row) {
        ctx.save(); ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.arc(x, y, sz / 2, 0, 7); ctx.clip();
        ctx.drawImage(flagImg(b.code), x - sz / 2, y - sz / 2, sz, sz);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        ctx.restore();
        x += sz + gap;
      }
    });
    const y = top + Math.max(rows.length, 1) * (sz + gap) + 40;
    ctx.font = '900 44px Montserrat'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
    spaced(winner ? cfg.t.champion : fmt(cfg.t.left, balls.length), CX, y, 3);
  }

  function drawWinner() {
    const k = Math.min(1, (frameNo - winFrame) / 20);
    ctx.save();
    ctx.globalAlpha = k;
    ctx.font = '900 104px Montserrat'; ctx.textAlign = 'center';
    ctx.shadowColor = winner.color; ctx.shadowBlur = 40;
    ctx.fillStyle = '#ffffff';
    const t = fmt(cfg.t.wins, winner.name).toUpperCase();
    let fs = 104; while (ctx.measureText(t).width > 2 * Math.sqrt(R * R - 230 * 230) - 60 && fs > 50) { fs -= 4; ctx.font = `900 ${fs}px Montserrat`; }
    ctx.fillText(t, CX, CY - 200);
    ctx.restore();
  }

  function spaced(text, x, y, sp) {
    ctx.save(); ctx.letterSpacing = sp + 'px'; ctx.fillText(text, x, y); ctx.restore();
  }
  function fmt(t, v) { return t.replace('{}', v); }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---- frame driver ----
  function update() {
    const dt = 1 / FPS / SUB;
    if (!winner) {
      // end-game arena shrink to force contact
      if (balls.length <= 3) R = Math.max(300, R - 0.35);
      for (let s = 0; s < SUB; s++) { steer(); step(dt); }
      for (const b of balls.filter(b => b.hp <= 0).sort((a, b) => a.hp - b.hp)) if (balls.length > 1) kill(b);
      for (const b of balls) if (b.hp <= 0) b.hp = 1;
      // grow balls as the field thins
      const tr = targetRadius(balls.length);
      for (const b of balls) b.r += (tr - b.r) * 0.04;
      if (balls.length === 1) {
        winner = balls[0]; winFrame = frameNo;
        events.push({ f: frameNo, type: 'win', v: 1 });
      }
    } else {
      // winner glides to center and grows
      const w = winner;
      w.x += (CX - w.x) * 0.08; w.y += (CY + 120 - w.y) * 0.08; w.r += (150 - w.r) * 0.08;
      if ((frameNo - winFrame) % 6 === 0) for (let k = 0; k < 14; k++) {
        const colors = [w.color, '#ffd23f', '#ffffff', '#ff4d8d', '#3ddcff'];
        spark(rnd(80, 1000), rnd(500, 700), colors[k % 5], 300, 1.6);
      }
    }
    for (const b of balls) b.flash = Math.max(0, b.flash - 0.12);
    for (const p of particles) { p.x += p.vx / FPS; p.y += p.vy / FPS; p.vx *= 0.94; p.vy *= 0.94; if (winner) p.vy += 9; p.life -= 1 / FPS; }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    for (const r of rings) r.life -= 1 / FPS;
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].life <= 0) rings.splice(i, 1);
    frameNo++;
  }

  window.BB = {
    async init() {
      await document.fonts.load('900 40px Montserrat');
      await Promise.all(cfg.countries.map(c => new Promise(res => {
        const im = new Image(); im.onload = res; im.src = c.flag; imgs[c.code] = im;
      })));
    },
    frame(render) { update(); if (render) draw(); return { done: winner && frameNo - winFrame > cfg.holdEnd * FPS, frame: frameNo }; },
    shot() { return cv.toDataURL('image/jpeg', 0.9); },
    events() { return events; },
    deaths() { return dead.map(d => d.name); },
  };
})();
