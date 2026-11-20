import { $, $$, api, toast, icon, fmt, hexA, setLoading } from './util.js';
import { store, on } from './store.js';
import { CityMap } from './citymap.js';
import { hbars } from './charts.js';

const ALGOS = [
  { key: 'astar', name: 'A* search', sub: 'f(n) = g(n) + h(n) · informed', color: '#5eead4' },
  { key: 'ucs', name: 'Uniform-cost search', sub: 'f(n) = g(n) · Dijkstra, uninformed', color: '#38bdf8' },
  { key: 'greedy', name: 'Greedy best-first', sub: 'f(n) = h(n) · informed, not optimal', color: '#fbbf24' },
  { key: 'bfs', name: 'Breadth-first search', sub: 'fewest edges · ignores road weights', color: '#c084fc' },
];

const panes = [];
let start = 0, goal = 63;
let picking = 'start';
let result = null;
let step = Infinity;
let speed = 2;
let runId = 0;
let ready = false;

function manhattan(a, b, N) {
  return Math.abs(Math.floor(a / N) - Math.floor(b / N)) + Math.abs((a % N) - (b % N));
}

export function initSearchLab() {
  const grid = $('#sl-grid');
  grid.innerHTML = ALGOS.map(a => `
    <div class="card algo-pane" data-k="${a.key}">
      <div class="pane-head"><b><i style="background:${a.color};box-shadow:0 0 12px ${a.color}"></i>${a.name}</b><small>${a.sub}</small></div>
      <div class="canvas-box"><canvas></canvas></div>
      <div class="pane-foot">
        <div><small>Expanded</small><b class="sl-exp">-</b></div>
        <div><small>Path cost</small><b class="sl-cost">-</b></div>
        <div><small>Optimal</small><b class="sl-opt">-</b></div>
      </div>
    </div>`).join('');

  ALGOS.forEach(a => {
    const el = $(`.algo-pane[data-k="${a.key}"]`);
    const map = new CityMap($('canvas', el), {
      labels: false, buildings: false, flow: false, pad: 20,
      describe: hit => describe(hit, a, map),
    });
    map.overlay = (ctx, m) => drawOverlay(ctx, m, a);
    map.on('pick', hit => hit.kind === 'node' && place(hit.n)).on('blank', n => place(n));
    panes.push({ a, el, map });
  });

  $$('#sl-speed button').forEach(b => b.addEventListener('click', () => {
    $$('#sl-speed button').forEach(x => x.classList.toggle('on', x === b));
    speed = +b.dataset.s;
  }));
  $('#sl-random').addEventListener('click', () => {
    const N = store.scenario?.grid || 8;
    start = Math.floor(Math.random() * N * N);
    do { goal = Math.floor(Math.random() * N * N); } while (manhattan(start, goal, N) < N);
    run();
  });
  $('#sl-run').addEventListener('click', run);

  on('scenario', sc => {
    const N = sc.grid || 8;
    const base = { grid: N, road_seed: sc.road_seed, technicians: [], jobs: [] };
    panes.forEach(p => p.map.setScenario(base, store.roads));
    if (start >= N * N || goal >= N * N) { start = 0; goal = N * N - 1; }
    result = null;
    ready = false;
    paintFoot();
  });
  on('solution', () => panes.forEach(p => p.map.setScenario({ grid: store.scenario.grid, road_seed: store.scenario.road_seed, technicians: [], jobs: [] }, store.roads)));
}

export function showSearchLab() {
  if (!ready && store.scenario) run();
}

function place(n) {
  if (picking === 'start') {
    start = n;
    picking = 'goal';
    result = null;
    paintFoot();
    toast(`Start set to node ${n}. Click again to choose the goal.`, 'info', 2200);
  } else {
    if (n === start) return;
    goal = n;
    picking = 'start';
    run();
  }
}

async function run() {
  if (!store.scenario) return;
  const btn = $('#sl-run');
  setLoading(btn, true);
  try {
    const sc = store.scenario;
    result = await api('/api/search', { grid: sc.grid, road_seed: sc.road_seed, closed_roads: sc.closed_roads, start, goal });
    ready = true;
    animate();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setLoading(btn, false);
  }
}

function animate() {
  const id = ++runId;
  const longest = Math.max(...ALGOS.map(a => result.results[a.key].expanded.length));
  const perStep = [0, 90, 45, 16][speed] || 45;
  const t0 = performance.now();
  step = 0;
  paintFoot();
  const tick = now => {
    if (id !== runId) return;
    step = Math.max(0, Math.floor((now - t0) / perStep));
    paintFoot();
    if (step <= longest) requestAnimationFrame(tick);
    else finish();
  };
  requestAnimationFrame(tick);
}

function finish() {
  const r = result.results;
  $('#sl-pair').textContent = `start ${result.start} → goal ${result.goal}`;
  hbars($('#sl-chart'), ALGOS.map(a => ({
    label: a.name.replace(' search', ''),
    value: r[a.key].nodes_expanded,
    color: a.color,
    text: `${r[a.key].nodes_expanded}`,
  })));
  const saved = r.ucs.nodes_expanded - r.astar.nodes_expanded;
  if (r.astar.cost != null) toast(`A* found the optimal cost ${fmt(r.astar.cost, 2)} and expanded ${saved} fewer nodes than UCS`, 'ok');
  else toast('No path exists: the goal is cut off by closed roads', 'err');
}

function paintFoot() {
  panes.forEach(({ a, el }) => {
    const r = result?.results[a.key];
    const done = r && step >= r.expanded.length;
    $('.sl-exp', el).textContent = r ? Math.min(step, r.expanded.length) : '-';
    $('.sl-cost', el).textContent = done ? (r.cost == null ? '∞' : fmt(r.cost, 2)) : '-';
    const opt = $('.sl-opt', el);
    opt.innerHTML = done ? (r.optimal ? `<span style="color:#4ade80">${icon('check')}</span>` : `<span style="color:#fb7185">${icon('x')}</span>`) : '-';
    opt.querySelector('svg')?.setAttribute('width', 18);
  });
}

function drawOverlay(ctx, m, a) {
  const N = m.N;
  const cell = m.cell;
  const r = result?.results[a.key];
  if (r) {
    const k = Math.min(step, r.expanded.length);
    const s = cell * 0.46;
    for (let i = 0; i < k; i++) {
      const [x, y] = m.xy(r.expanded[i]);
      const age = 1 - i / Math.max(1, r.expanded.length);
      ctx.fillStyle = hexA(a.color, 0.12 + 0.5 * age);
      ctx.beginPath();
      ctx.roundRect(x - s / 2, y - s / 2, s, s, 5);
      ctx.fill();
    }
    if (k > 0 && k < r.expanded.length) {
      const [x, y] = m.xy(r.expanded[k - 1]);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, Math.PI * 2); ctx.stroke();
    }
    if (k >= r.expanded.length && r.path.length) {
      ctx.save();
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(3, cell * 0.08);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      r.path.forEach((n, i) => { const [x, y] = m.xy(n); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.restore();
    }
  }
  const mark = (n, label, color) => {
    const [x, y] = m.xy(n);
    const rr = Math.max(9, cell * 0.2);
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#06121c';
    ctx.font = `700 ${Math.round(rr * 1.05)}px "Space Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 1);
    ctx.restore();
  };
  mark(start, 'A', '#4ade80');
  if (picking !== 'goal') mark(goal, 'B', '#fb7185');
}

function describe(hit, a, m) {
  if (hit.kind !== 'node') return '';
  const N = m.N;
  const r = result?.results[a.key];
  const order = r ? r.expanded.indexOf(hit.n) : -1;
  return `<h5>Node ${hit.n}</h5>
    <div class="tt-row">h(n) to goal <b>${manhattan(hit.n, goal, N)}</b></div>
    <div class="tt-row">Expanded by ${a.name.split(' ')[0]} <b>${order >= 0 ? '#' + (order + 1) : 'no'}</b></div>
    <div style="margin-top:6px;color:#a5b3cb">Click to set as ${picking === 'start' ? 'start (A)' : 'goal (B)'}</div>`;
}
