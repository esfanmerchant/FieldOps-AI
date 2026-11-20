import { techColor, techName, skillMeta, hhmm, tooltip } from './util.js';

const GLYPH = {
  zap: new Path2D('M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'),
  droplet: new Path2D('M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'),
  snow: new Path2D('M2 12H22M12 2V22M20 16L16 12L20 8M4 8L8 12L4 16M16 4L12 8L8 4M8 20L12 16L16 20'),
  alert: new Path2D('M12 3L22 20H2Z M12 9v5 M12 17h.01'),
  truck: new Path2D('M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14M19 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0M9 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0'),
  check: new Path2D('M20 6 9 17l-5-5'),
};

function glyph(ctx, name, x, y, size, color, width = 2.4) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(GLYPH[name]);
  ctx.restore();
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixColor(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = s => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const key = (u, v) => (u < v ? `${u}-${v}` : `${v}-${u}`);

export class CityMap {
  constructor(canvas, opts = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.o = { pad: 36, labels: true, buildings: true, interactive: true, flow: true, ...opts };
    this.sc = null;
    this.plan = null;
    this.legs = null;
    this.time = null;
    this.reveal = 1;
    this.mode = 'view';
    this.hover = null;
    this.highlight = -1;
    this.dash = 0;
    this.overlay = null;
    this.handlers = {};
    this.w = this.h = 0;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    if (this.o.interactive) this.bind();
    const tick = now => { this.frame(now); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  on(name, fn) { this.handlers[name] = fn; return this; }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  layout() {
    if (!this.sc || !this.w) return;
    const N = this.N, p = this.o.pad, top = this.o.padTop ?? p, bottom = this.o.padBottom ?? p;
    this.cell = Math.min((this.w - 2 * p) / (N - 1), (this.h - bottom - top) / (N - 1));
    this.ox = (this.w - this.cell * (N - 1)) / 2;
    this.oy = top + (this.h - bottom - top - this.cell * (N - 1)) / 2;
  }

  xy(n) {
    return [this.ox + (n % this.N) * this.cell, this.oy + Math.floor(n / this.N) * this.cell];
  }

  setScenario(sc, roads) {
    this.sc = sc;
    this.N = sc.grid || 8;
    this.roads = roads || [];
    this.weight = new Map(this.roads.map(([u, v, w]) => [key(u, v), w]));
    this.plan = null;
    this.legs = null;
    this.time = null;
    this.spots();
    this.makeBlocks(sc.road_seed || 1);
    this.layout();
  }

  spots() {
    const at = new Map();
    const add = (node, item) => { if (!at.has(node)) at.set(node, []); at.get(node).push(item); };
    this.sc.technicians.forEach((t, i) => add(t.start_node, ['tech', i]));
    this.sc.jobs.forEach((j, i) => add(j.node, ['job', i]));
    this.spot = { tech: [], job: [] };
    for (const [node, items] of at) {
      items.forEach(([kind, id], k) => {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / items.length;
        this.spot[kind][id] = { node, dx: items.length > 1 ? Math.cos(a) : 0, dy: items.length > 1 ? Math.sin(a) : 0 };
      });
    }
  }

  spotXY(kind, id) {
    const s = this.spot[kind][id];
    const [x, y] = this.xy(s.node);
    const r = Math.min(this.cell * 0.22, 15);
    return [x + s.dx * r, y + s.dy * r];
  }

  makeBlocks(seed) {
    const rand = rng(seed * 7919 + 17);
    this.blocks = [];
    for (let r = 0; r < this.N - 1; r++) {
      for (let c = 0; c < this.N - 1; c++) {
        const b = [];
        const n = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          b.push([rand() * 0.6, rand() * 0.6, 0.18 + rand() * 0.3, 0.18 + rand() * 0.3, rand()]);
        }
        this.blocks.push({ r, c, b, park: rand() < 0.08 });
      }
    }
  }

  setPlan(plan, animate = true) {
    this.plan = plan;
    this.legs = plan ? plan.techs.map(t => t.legs) : null;
    if (animate) this.startReveal();
  }

  setRoutes(routes, paths) {
    if (!routes) { this.plan = null; this.legs = null; return; }
    this.plan = { techs: routes.map((r, i) => ({ id: i, route: r })) };
    this.legs = routes.map((r, i) => {
      let here = this.sc.technicians[i].start_node;
      return r.map(j => {
        const node = this.sc.jobs[j].node;
        const leg = { job: j, path: paths[`${here}-${node}`] || [here, node] };
        here = node;
        return leg;
      });
    });
  }

  startReveal(ms = 1200) {
    this.reveal = 0;
    this.revealT0 = performance.now();
    this.revealMs = ms;
  }

  assigned() {
    const m = new Map();
    if (!this.legs) return m;
    this.legs.forEach((legs, t) => legs.forEach(l => m.set(l.job, { tech: t, leg: l })));
    return m;
  }

  frame(now) {
    if (!this.c.offsetParent || !this.sc || !this.w) return;
    if (this.reveal < 1) {
      const k = Math.min(1, (now - this.revealT0) / this.revealMs);
      this.reveal = 1 - Math.pow(1 - k, 3);
    }
    this.dash = (this.dash + 0.55) % 1000;
    this.now = now;
    this.handlers.frame?.(now);
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawBlocks(ctx);
    this.drawRoads(ctx);
    if (this.overlay) this.overlay(ctx, this);
    this.drawRoutes(ctx);
    this.drawHover(ctx);
    this.drawDepots(ctx);
    this.drawJobs(ctx);
    this.drawVans(ctx);
  }

  drawBlocks(ctx) {
    const cell = this.cell, inset = Math.max(4, cell * 0.13);
    for (const blk of this.blocks) {
      const x = this.ox + blk.c * cell + inset, y = this.oy + blk.r * cell + inset, s = cell - 2 * inset;
      ctx.beginPath();
      ctx.roundRect(x, y, s, s, Math.min(8, s * 0.18));
      ctx.fillStyle = blk.park ? 'rgba(34, 84, 61, .32)' : 'rgba(26, 37, 62, .55)';
      ctx.fill();
      if (!this.o.buildings || blk.park || s < 26) continue;
      for (const [bx, by, bw, bh, lit] of blk.b) {
        ctx.fillStyle = lit > 0.82 ? 'rgba(94, 234, 212, .10)' : 'rgba(64, 82, 122, .28)';
        ctx.fillRect(x + 4 + bx * (s - 8), y + 4 + by * (s - 8), bw * (s - 8), bh * (s - 8));
      }
    }
  }

  roadWidth() { return Math.max(3, Math.min(9, this.cell * 0.1)); }

  drawRoads(ctx) {
    const base = this.roadWidth();
    ctx.lineCap = 'round';
    for (const [u, v, w, closed] of this.roads) {
      const [x1, y1] = this.xy(u), [x2, y2] = this.xy(v);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = base + 3;
      ctx.strokeStyle = closed ? 'rgba(127, 29, 29, .6)' : 'rgba(5, 9, 18, .95)';
      ctx.stroke();
      ctx.lineWidth = base;
      ctx.strokeStyle = closed ? 'rgba(244, 63, 94, .35)' : mixColor('#2a3a58', '#b7791f', Math.min(1, (w - 1) / 0.5) * 0.85);
      ctx.stroke();
      if (closed) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, s = Math.max(4, base * 0.8);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fb7185';
        ctx.beginPath();
        ctx.moveTo(mx - s, my - s); ctx.lineTo(mx + s, my + s);
        ctx.moveTo(mx + s, my - s); ctx.lineTo(mx - s, my + s);
        ctx.stroke();
      } else if (this.cell > 46) {
        ctx.setLineDash([3, 7]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, .07)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const dot = this.mode === 'job' ? 3.2 : 1.6;
    ctx.fillStyle = this.mode === 'job' ? 'rgba(251, 191, 36, .45)' : 'rgba(148, 163, 184, .28)';
    for (let n = 0; n < this.N * this.N; n++) {
      const [x, y] = this.xy(n);
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  techSegments(t) {
    const legs = this.legs[t];
    const T = this.legs.length;
    const off = (t - (T - 1) / 2) * Math.max(1.6, this.roadWidth() * 0.45);
    const segs = [];
    for (const leg of legs) {
      const p = leg.path;
      for (let k = 0; k < p.length - 1; k++) {
        const [x1, y1] = this.xy(p[k]), [x2, y2] = this.xy(p[k + 1]);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const nx = -(y2 - y1) / len * off, ny = (x2 - x1) / len * off;
        segs.push([x1 + nx, y1 + ny, x2 + nx, y2 + ny, len]);
      }
    }
    return segs;
  }

  drawRoutes(ctx) {
    if (!this.legs) return;
    const lw = Math.max(2.2, Math.min(5, this.cell * 0.055));
    this.legs.forEach((_, t) => {
      const segs = this.techSegments(t);
      if (!segs.length) return;
      const total = segs.reduce((s, g) => s + g[4], 0);
      let budget = total * this.reveal;
      const dim = this.highlight >= 0 && this.highlight !== t;
      const color = techColor(t);
      ctx.save();
      ctx.globalAlpha = dim ? 0.18 : this.time != null ? 0.75 : 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const [x1, y1, x2, y2, len] of segs) {
        if (budget <= 0) break;
        const k = Math.min(1, budget / len);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k);
        budget -= len;
      }
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = this.highlight === t ? lw + 1.5 : lw;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (this.o.flow && !dim) {
        ctx.shadowBlur = 0;
        ctx.setLineDash([2, 13]);
        ctx.lineDashOffset = -this.dash;
        ctx.lineWidth = Math.max(1.4, lw * 0.45);
        ctx.strokeStyle = 'rgba(255, 255, 255, .7)';
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  drawHover(ctx) {
    const h = this.hover;
    if (!h) return;
    if (h.kind === 'edge') {
      const [x1, y1] = this.xy(h.u), [x2, y2] = this.xy(h.v);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = this.roadWidth() + 6;
      ctx.strokeStyle = h.closed ? 'rgba(74, 222, 128, .45)' : 'rgba(251, 113, 133, .5)';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    } else if (h.kind === 'node') {
      const [x, y] = this.xy(h.n);
      ctx.save();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  drawDepots(ctx) {
    const s = Math.max(15, Math.min(28, this.cell * 0.34));
    this.sc.technicians.forEach((t, i) => {
      const [x, y] = this.spotXY('tech', i);
      const color = techColor(i);
      const dim = this.highlight >= 0 && this.highlight !== i;
      ctx.save();
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.28);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      glyph(ctx, 'truck', x, y, s * 0.66, '#06121c', 2.6);
      if (this.o.labels) {
        ctx.font = '700 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(`T${i}`, x, y - s / 2 - 5);
      }
      ctx.restore();
    });
  }

  jobState(j, info) {
    if (!this.plan) return 'idle';
    if (!info) return 'unserved';
    if (this.time == null || info.leg.begin == null) return 'served';
    if (this.time < info.leg.arrival) return 'pending';
    if (this.time < info.leg.finish) return 'active';
    return 'done';
  }

  drawJobs(ctx) {
    const r = Math.max(7, Math.min(13, this.cell * 0.15));
    const assigned = this.assigned();
    const pulse = (Math.sin((this.now || 0) / 260) + 1) / 2;
    this.sc.jobs.forEach((job, j) => {
      const [x, y] = this.spotXY('job', j);
      const meta = skillMeta(job.skill);
      const info = assigned.get(j);
      const state = this.jobState(j, info);
      const dim = this.highlight >= 0 && (!info || info.tech !== this.highlight);
      ctx.save();
      ctx.globalAlpha = dim ? 0.3 : state === 'pending' ? 0.55 : 1;
      if (state === 'unserved') {
        ctx.strokeStyle = `rgba(251, 113, 133, ${0.45 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, r + 5 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      } else if (info) {
        const c = techColor(info.tech);
        ctx.strokeStyle = c;
        ctx.lineWidth = state === 'active' ? 3 : 2;
        if (state === 'active') { ctx.shadowColor = c; ctx.shadowBlur = 10 + pulse * 14; }
        ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
        if (state === 'active') {
          const k = (this.time - info.leg.begin) / Math.max(1, info.leg.finish - info.leg.begin);
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#fff';
          ctx.beginPath(); ctx.arc(x, y, r + 3.5, -Math.PI / 2, -Math.PI / 2 + Math.max(0, k) * Math.PI * 2); ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#0a1222';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = meta.color;
      ctx.stroke();
      glyph(ctx, meta.icon in GLYPH ? meta.icon : 'alert', x, y, r * 1.2, meta.color, 2.2);
      if (state === 'done') {
        ctx.beginPath();
        ctx.arc(x + r * 0.8, y - r * 0.8, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#4ade80';
        ctx.fill();
        glyph(ctx, 'check', x + r * 0.8, y - r * 0.8, r * 0.7, '#052e16', 3.4);
      }
      if (this.o.labels) {
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(226, 232, 240, .78)';
        ctx.fillText(`J${j}`, x + r + 3, y - r + 2);
      }
      ctx.restore();
    });
  }

  vanAt(t, time) {
    const tech = this.sc.technicians[t];
    let here = tech.start_node;
    for (const leg of this.legs[t]) {
      if (time < leg.depart) return this.xy(here);
      if (time <= leg.arrival && leg.arrival > leg.depart) {
        const k = (time - leg.depart) / (leg.arrival - leg.depart);
        return this.along(leg.path, k);
      }
      here = leg.path[leg.path.length - 1];
      if (time < leg.finish) return this.xy(here);
    }
    return this.xy(here);
  }

  along(path, k) {
    if (path.length < 2) return this.xy(path[0]);
    const ws = [];
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const w = this.weight.get(key(path[i], path[i + 1])) || 1;
      ws.push(w);
      total += w;
    }
    let d = k * total;
    for (let i = 0; i < ws.length; i++) {
      if (d <= ws[i]) {
        const [x1, y1] = this.xy(path[i]), [x2, y2] = this.xy(path[i + 1]);
        const f = d / ws[i];
        return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
      }
      d -= ws[i];
    }
    return this.xy(path[path.length - 1]);
  }

  drawVans(ctx) {
    if (this.time == null || !this.legs || this.legs.some(l => l.some(x => x.depart == null))) return;
    const r = Math.max(6, Math.min(11, this.cell * 0.12));
    this.legs.forEach((legs, t) => {
      if (!legs.length) return;
      const [x, y] = this.vanAt(t, this.time);
      const c = techColor(t);
      ctx.save();
      ctx.shadowColor = c;
      ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = '#06121c'; ctx.fill();
      ctx.restore();
    });
  }

  pick(mx, my) {
    if (!this.sc) return null;
    const jr = Math.max(10, Math.min(16, this.cell * 0.2));
    for (let j = this.sc.jobs.length - 1; j >= 0; j--) {
      const [x, y] = this.spotXY('job', j);
      if (Math.hypot(mx - x, my - y) < jr) return { kind: 'job', id: j };
    }
    const ts = Math.max(15, Math.min(28, this.cell * 0.34)) / 2 + 3;
    for (let i = 0; i < this.sc.technicians.length; i++) {
      const [x, y] = this.spotXY('tech', i);
      if (Math.abs(mx - x) < ts && Math.abs(my - y) < ts) return { kind: 'tech', id: i };
    }
    if (this.mode === 'road') {
      let best = null, bd = 10;
      for (const [u, v, w, closed] of this.roads) {
        const [x1, y1] = this.xy(u), [x2, y2] = this.xy(v);
        const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        const k = Math.max(0.12, Math.min(0.88, ((mx - x1) * (x2 - x1) + (my - y1) * (y2 - y1)) / L2));
        const d = Math.hypot(mx - (x1 + k * (x2 - x1)), my - (y1 + k * (y2 - y1)));
        if (d < bd) { bd = d; best = { kind: 'edge', u, v, w, closed }; }
      }
      return best;
    }
    const c = Math.round((mx - this.ox) / this.cell), r = Math.round((my - this.oy) / this.cell);
    if (c >= 0 && r >= 0 && c < this.N && r < this.N) {
      const n = r * this.N + c;
      const [x, y] = this.xy(n);
      if (Math.hypot(mx - x, my - y) < this.cell * 0.38) return { kind: 'node', n };
    }
    return null;
  }

  bind() {
    const pos = e => { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    this.c.addEventListener('mousemove', e => {
      const [mx, my] = pos(e);
      const hit = this.pick(mx, my);
      this.hover = hit && ((this.mode === 'road' && hit.kind === 'edge') || (this.mode === 'job' && hit.kind === 'node')) ? hit : null;
      const html = hit && this.describe(hit);
      if (html) tooltip.show(html, e.clientX, e.clientY); else tooltip.hide();
      const hl = hit && hit.kind === 'tech' ? hit.id : -1;
      if (hl !== this.highlight && !this.lockHighlight) { this.highlight = hl; this.handlers.highlight?.(hl); }
      this.c.style.cursor = hit && (hit.kind === 'job' || hit.kind === 'tech' || this.hover) ? 'pointer' : '';
    });
    this.c.addEventListener('mouseleave', () => {
      tooltip.hide();
      this.hover = null;
      if (!this.lockHighlight && this.highlight !== -1) { this.highlight = -1; this.handlers.highlight?.(-1); }
    });
    this.c.addEventListener('click', e => {
      const [mx, my] = pos(e);
      const hit = this.pick(mx, my);
      if (this.mode === 'road' && hit?.kind === 'edge') this.handlers.road?.(hit.u, hit.v);
      else if (this.mode === 'job' && hit?.kind === 'node') this.handlers.node?.(hit.n);
      else if (hit) this.handlers.pick?.(hit);
      else this.handlers.blank?.(this.nearestNode(mx, my));
    });
  }

  nearestNode(mx, my) {
    const c = Math.max(0, Math.min(this.N - 1, Math.round((mx - this.ox) / this.cell)));
    const r = Math.max(0, Math.min(this.N - 1, Math.round((my - this.oy) / this.cell)));
    return r * this.N + c;
  }

  describe(hit) {
    if (this.o.describe) return this.o.describe(hit, this);
    if (hit.kind === 'job') {
      const job = this.sc.jobs[hit.id];
      const m = skillMeta(job.skill);
      const info = this.assigned().get(hit.id);
      let status = '';
      if (info && info.leg.begin != null) {
        status = `<div class="tt-row">Assigned <b style="color:${techColor(info.tech)}">T${info.tech} ${techName(info.tech)}</b></div>
          <div class="tt-row">Arrives <b>${hhmm(info.leg.arrival)}</b></div><div class="tt-row">On site <b>${hhmm(info.leg.begin)} - ${hhmm(info.leg.finish)}</b></div>`;
      } else if (info) {
        status = `<div class="tt-row">Assigned <b style="color:${techColor(info.tech)}">T${info.tech}</b></div>`;
      } else if (this.plan) {
        const u = this.unservedReason?.(hit.id);
        status = `<div class="tt-row" style="color:#fb7185">Unassigned</div>${u ? `<div style="color:#a5b3cb;margin-top:4px">${u}</div>` : ''}`;
      }
      return `<h5><span style="color:${m.color}">J${hit.id}</span> ${m.label}</h5>
        <div class="tt-row">Window <b>${hhmm(job.start)} - ${hhmm(job.end)}</b></div>
        <div class="tt-row">Service <b>${job.duration} min</b></div>
        <div class="tt-row">Priority <b>${job.priority > 1 ? 'high ×' + job.priority : 'normal'}</b></div>
        <div class="tt-row">Node <b>${job.node}</b></div>${status}`;
    }
    if (hit.kind === 'tech') {
      const t = this.sc.technicians[hit.id];
      const p = this.plan?.techs?.[hit.id];
      return `<h5><span style="color:${techColor(hit.id)}">T${hit.id}</span> ${techName(hit.id)}</h5>
        <div class="tt-row">Skills <b>${t.skills.join(', ')}</b></div>
        <div class="tt-row">Shift <b>${hhmm(t.shift_start)} - ${hhmm(t.shift_end)}</b></div>
        <div class="tt-row">Depot node <b>${t.start_node}</b></div>
        ${p && p.km != null ? `<div class="tt-row">Jobs <b>${p.route.length}</b></div><div class="tt-row">Travel <b>${p.km} km</b></div>` : ''}`;
    }
    if (hit.kind === 'edge') {
      return `<h5>Road ${hit.u} ↔ ${hit.v}</h5><div class="tt-row">Edge weight <b>${hit.w}</b></div>
        <div class="tt-row">Length <b>${(hit.w * 0.8).toFixed(2)} km</b></div>
        <div style="margin-top:6px;color:${hit.closed ? '#4ade80' : '#fb7185'}">Click to ${hit.closed ? 'reopen' : 'close'} this road</div>`;
    }
    if (hit.kind === 'node' && this.mode === 'job') return `<h5>Intersection ${hit.n}</h5><div style="color:#fbbf24">Click to place a new job here</div>`;
    return '';
  }
}
