import { tooltip, fmt } from './util.js';

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.5; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

const AXIS = 'rgba(140,162,205,.16)';
const LABEL = '#6a7a97';

export class LineChart {
  constructor(el, opts = {}) {
    this.el = el;
    this.o = { height: 280, pad: { l: 54, r: 20, t: 18, b: 38 }, xLabel: 'Generation', yLabel: 'Cost', ...opts };
    this.data = null;
    this.k = Infinity;
    new ResizeObserver(() => this.render()).observe(el);
  }

  set(data) {
    this.data = data;
    this.k = data.progress ?? Infinity;
    this.render();
  }

  progress(k) {
    this.k = k;
    this.render();
  }

  render() {
    const d = this.data;
    const W = this.el.clientWidth;
    if (!d || !W) return;
    const H = this.o.height, p = this.o.pad;
    const n = d.n ?? Math.max(...d.series.map(s => s.values.length));
    const all = d.series.flatMap(s => s.values).concat(d.band ? [...d.band.lo, ...d.band.hi] : []).concat(d.ref ? [d.ref.y] : []);
    let lo = d.yMin ?? Math.min(...all), hi = d.yMax ?? Math.max(...all);
    const padY = (hi - lo) * 0.08 || 1;
    lo -= padY; hi += padY;
    const ticks = niceTicks(lo, hi, 5);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const X = i => p.l + (i / Math.max(1, n - 1)) * (W - p.l - p.r);
    const Y = v => p.t + (1 - (v - lo) / (hi - lo)) * (H - p.t - p.b);
    const k = Math.min(this.k, n);

    let g = '';
    for (const t of ticks) {
      if (t < lo || t > hi) continue;
      g += `<line x1="${p.l}" x2="${W - p.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${AXIS}" stroke-dasharray="3 4"/>`;
      g += `<text x="${p.l - 10}" y="${Y(t) + 4}" text-anchor="end" fill="${LABEL}" font-size="11" font-family="JetBrains Mono">${fmt(t, t % 1 ? 1 : 0)}</text>`;
    }
    const xt = niceTicks(0, n - 1, Math.min(8, n - 1 || 1)).filter(v => v <= n - 1 && Number.isInteger(v));
    for (const t of xt) g += `<text x="${X(t)}" y="${H - p.b + 18}" text-anchor="middle" fill="${LABEL}" font-size="11" font-family="JetBrains Mono">${t}</text>`;
    g += `<text x="${(W + p.l) / 2}" y="${H - 4}" text-anchor="middle" fill="${LABEL}" font-size="11">${this.o.xLabel}</text>`;
    g += `<text transform="translate(13 ${(H - p.b + p.t) / 2}) rotate(-90)" text-anchor="middle" fill="${LABEL}" font-size="11">${this.o.yLabel}</text>`;

    if (d.ref) {
      g += `<line x1="${p.l}" x2="${W - p.r}" y1="${Y(d.ref.y)}" y2="${Y(d.ref.y)}" stroke="${d.ref.color || '#fb7185'}" stroke-width="1.4" stroke-dasharray="6 5" opacity=".8"/>`;
      g += `<text x="${W - p.r}" y="${Y(d.ref.y) - 7}" text-anchor="end" fill="${d.ref.color || '#fb7185'}" font-size="11" font-weight="600">${d.ref.label}</text>`;
    }

    let defs = '';
    if (d.band && k > 0) {
      const top = d.band.hi.slice(0, k).map((v, i) => `${X(i)},${Y(v)}`);
      const bot = d.band.lo.slice(0, k).map((v, i) => `${X(i)},${Y(v)}`).reverse();
      g += `<polygon points="${top.concat(bot).join(' ')}" fill="${d.band.color}" opacity=".13"/>`;
    }
    d.series.forEach((s, si) => {
      const vals = s.values.slice(0, k);
      if (!vals.length) return;
      const pts = vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
      if (s.area) {
        defs += `<linearGradient id="ga${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
        g += `<polygon points="${X(0)},${H - p.b} ${pts} ${X(vals.length - 1)},${H - p.b}" fill="url(#ga${si})"/>`;
      }
      g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} ${s.glow ? `filter="url(#glow)"` : ''}/>`;
      if (s.head && vals.length) {
        const i = vals.length - 1;
        g += `<circle cx="${X(i)}" cy="${Y(vals[i])}" r="5" fill="${s.color}" stroke="#fff" stroke-width="2"/>`;
      }
    });
    (d.marks || []).filter(m => m.i < k).forEach(m => {
      g += `<circle cx="${X(m.i)}" cy="${Y(m.v)}" r="3.2" fill="#0a1222" stroke="${m.color || '#5eead4'}" stroke-width="1.6"/>`;
    });
    (d.labels || []).forEach(l => {
      if (l.i >= k) return;
      g += `<circle cx="${X(l.i)}" cy="${Y(l.v)}" r="5" fill="#203a63" stroke="#fff" stroke-width="1.5"/>`;
      g += `<text x="${X(l.i) + (l.dx || 0)}" y="${Y(l.v) + (l.dy || -12)}" text-anchor="middle" fill="#e8eef9" font-size="12" font-weight="600" font-family="JetBrains Mono">${l.text}</text>`;
    });

    this.el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs><filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>${defs}</defs>
      ${g}<line class="hover-line" x1="0" x2="0" y1="${p.t}" y2="${H - p.b}" stroke="rgba(255,255,255,.25)" visibility="hidden"/>
      <rect x="${p.l}" y="${p.t}" width="${W - p.l - p.r}" height="${H - p.t - p.b}" fill="transparent"/></svg>`;

    const svg = this.el.firstChild;
    const line = svg.querySelector('.hover-line');
    svg.onmousemove = e => {
      const r = svg.getBoundingClientRect();
      const i = Math.round(((e.clientX - r.left - p.l) / (W - p.l - p.r)) * (n - 1));
      if (i < 0 || i >= k || i >= n) { line.setAttribute('visibility', 'hidden'); tooltip.hide(); return; }
      line.setAttribute('x1', X(i)); line.setAttribute('x2', X(i));
      line.setAttribute('visibility', 'visible');
      const rows = d.series.map(s => `<div class="tt-row"><span style="color:${s.color}">${s.name}</span><b>${fmt(s.values[i], 2)}</b></div>`).join('');
      tooltip.show(`<h5>${this.o.xLabel} ${i}</h5>${rows}`, e.clientX, e.clientY);
    };
    svg.onmouseleave = () => { line.setAttribute('visibility', 'hidden'); tooltip.hide(); };
  }
}

export function groupedBars(el, { categories, series, height = 280, yLabel = '', format = v => fmt(v, 1) }) {
  const draw = () => {
    const W = el.clientWidth;
    if (!W) return;
    const H = height, p = { l: 50, r: 14, t: 16, b: 40 };
    const max = Math.max(...series.flatMap(s => s.values));
    const ticks = niceTicks(0, max, 5);
    const top = ticks[ticks.length - 1];
    const Y = v => p.t + (1 - v / top) * (H - p.t - p.b);
    const gw = (W - p.l - p.r) / categories.length;
    const bw = Math.max(3, (gw * 0.72) / series.length);
    let g = '';
    for (const t of ticks) {
      g += `<line x1="${p.l}" x2="${W - p.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${AXIS}" stroke-dasharray="3 4"/>`;
      g += `<text x="${p.l - 9}" y="${Y(t) + 4}" text-anchor="end" fill="${LABEL}" font-size="11" font-family="JetBrains Mono">${t}</text>`;
    }
    categories.forEach((c, i) => {
      const x0 = p.l + i * gw + (gw - bw * series.length) / 2;
      series.forEach((s, k) => {
        const v = s.values[i];
        const y = Y(v);
        g += `<rect class="bar" data-i="${i}" data-k="${k}" x="${x0 + k * bw}" y="${y}" width="${bw - 1.5}" height="${H - p.b - y}" rx="2.5" fill="${s.color}" style="animation-delay:${i * 22}ms"/>`;
      });
      g += `<text x="${p.l + i * gw + gw / 2}" y="${H - p.b + 16}" text-anchor="middle" fill="${LABEL}" font-size="10.5" font-family="JetBrains Mono">${c}</text>`;
    });
    g += `<text transform="translate(12 ${(H - p.b + p.t) / 2}) rotate(-90)" text-anchor="middle" fill="${LABEL}" font-size="11">${yLabel}</text>`;
    const legend = series.map((s, k) => `<g transform="translate(${p.l + k * 150} ${H - 6})"><rect width="10" height="10" y="-9" rx="2" fill="${s.color}"/><text x="16" fill="#a5b3cb" font-size="11">${s.name}</text></g>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H + 8}" width="${W}" height="${H + 8}">${g}${legend}</svg>`;
    el.querySelectorAll('.bar').forEach(b => {
      b.addEventListener('mousemove', e => {
        const i = +b.dataset.i;
        const rows = series.map(s => `<div class="tt-row"><span style="color:${s.color}">${s.name}</span><b>${format(s.values[i])}</b></div>`).join('');
        tooltip.show(`<h5>Scenario ${categories[i]}</h5>${rows}`, e.clientX, e.clientY);
      });
      b.addEventListener('mouseleave', () => tooltip.hide());
    });
  };
  new ResizeObserver(draw).observe(el);
  draw();
}

export function hbars(el, rows, { max } = {}) {
  const top = max || Math.max(...rows.map(r => r.value), 1);
  el.innerHTML = `<div style="display:grid;gap:12px;padding:6px 8px 10px">${rows.map(r => `
    <div style="display:grid;grid-template-columns:120px 1fr 64px;gap:12px;align-items:center;font-size:12.5px">
      <span style="display:flex;align-items:center;gap:8px"><i style="width:9px;height:9px;border-radius:50%;background:${r.color}"></i>${r.label}</span>
      <div style="height:14px;border-radius:7px;background:rgba(140,162,205,.08);overflow:hidden">
        <div class="hbar-fill" style="height:100%;width:0;border-radius:7px;background:${r.color};box-shadow:0 0 14px ${r.color}66;transition:width .9s cubic-bezier(.2,.8,.2,1)" data-w="${(r.value / top) * 100}"></div>
      </div>
      <b class="mono" style="text-align:right">${r.text ?? r.value}</b>
    </div>`).join('')}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.hbar-fill').forEach(b => { b.style.width = b.dataset.w + '%'; })));
}

function divergent(v, span) {
  const k = Math.max(-1, Math.min(1, v / span));
  if (Math.abs(k) < 0.02) return 'rgba(140,162,205,.12)';
  if (k > 0) return `rgba(${Math.round(20 + 74 * (1 - k))}, ${Math.round(140 + 94 * (1 - k * .4))}, ${Math.round(150 + 62 * (1 - k))}, ${0.25 + 0.75 * k})`;
  return `rgba(251, 146, 60, ${0.25 + 0.75 * -k})`;
}

export function heatmap(el, { rows, cols, values, span = 65, suffix = '%' }) {
  const draw = () => {
    const W = el.clientWidth;
    if (!W) return;
    const p = { l: 86, r: 10, t: 8, b: 30 };
    const cw = (W - p.l - p.r) / cols.length, ch = 42;
    const H = p.t + rows.length * ch + p.b;
    let g = '';
    rows.forEach((r, ri) => {
      g += `<text x="${p.l - 12}" y="${p.t + ri * ch + ch / 2 + 4}" text-anchor="end" fill="#a5b3cb" font-size="12">${r}</text>`;
      cols.forEach((c, ci) => {
        const v = values[ri][ci];
        const x = p.l + ci * cw, y = p.t + ri * ch;
        g += `<rect class="hm" data-r="${ri}" data-c="${ci}" x="${x + 1.5}" y="${y + 1.5}" width="${cw - 3}" height="${ch - 3}" rx="6" fill="${divergent(v, span)}" style="animation-delay:${(ri * cols.length + ci) * 12}ms"/>`;
        g += `<text x="${x + cw / 2}" y="${y + ch / 2 + 4}" text-anchor="middle" fill="${v > span * 0.55 ? '#04121a' : '#e8eef9'}" font-size="11" font-weight="600" font-family="JetBrains Mono" pointer-events="none">${fmt(v, 1)}</text>`;
      });
    });
    cols.forEach((c, ci) => { g += `<text x="${p.l + ci * cw + cw / 2}" y="${H - 10}" text-anchor="middle" fill="${LABEL}" font-size="11" font-family="JetBrains Mono">${c}</text>`; });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
    el.querySelectorAll('.hm').forEach(rc => {
      rc.addEventListener('mousemove', e => {
        const v = values[+rc.dataset.r][+rc.dataset.c];
        tooltip.show(`<h5>Scenario ${cols[+rc.dataset.c]} · ${rows[+rc.dataset.r]}</h5><div class="tt-row">Objective reduction <b>${fmt(v, 2)}${suffix}</b></div>`, e.clientX, e.clientY);
      });
      rc.addEventListener('mouseleave', () => tooltip.hide());
    });
  };
  new ResizeObserver(draw).observe(el);
  draw();
}

export function sparkline(values, color, w = 90, h = 30) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
