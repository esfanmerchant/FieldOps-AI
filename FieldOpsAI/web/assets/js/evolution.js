import { $, toast, icon, techColor, fmt, bindRange, setLoading } from './util.js';
import { store, on, solve } from './store.js';
import { CityMap } from './citymap.js';
import { LineChart } from './charts.js';

let mini, chart, popChart;
let runId = 0;
let lastChromo = null;
let fromLab = false;

const sliders = [
  ['#evo-pop', '#evo-pop-o', 'population', v => v],
  ['#evo-gen', '#evo-gen-o', 'generations', v => v],
  ['#evo-cx', '#evo-cx-o', 'crossover', v => v.toFixed(2)],
  ['#evo-mut', '#evo-mut-o', 'mutation', v => v.toFixed(2)],
];
const syncers = [];

export function initEvolution() {
  mini = new CityMap($('#evo-canvas'), { labels: false, buildings: false, pad: 20 });
  chart = new LineChart($('#evo-chart'), { height: 270, yLabel: 'Best objective cost' });
  const popBox = document.createElement('div');
  popBox.className = 'chart-wrap';
  popBox.style.borderTop = '1px solid var(--border)';
  $('#evo-chart').after(popBox);
  popChart = new LineChart(popBox, { height: 150, yLabel: 'Population', pad: { l: 54, r: 20, t: 14, b: 34 } });

  for (const [inp, out, , f] of sliders) syncers.push(bindRange($(inp), $(out), f));
  $('#evo-defaults').addEventListener('click', () => {
    const d = { population: 36, generations: 50, crossover: 0.8, mutation: 0.32 };
    sliders.forEach(([inp, , k]) => { $(inp).value = d[k]; });
    syncers.forEach(s => s());
    $('#evo-seed').value = 50000;
    toast('Parameters reset to the values used in the report', 'info');
  });
  $('#evo-run').addEventListener('click', run);

  const chip = sc => {
    $('#evo-chip').innerHTML = `${icon('pin')}seed ${sc.road_seed} · ${sc.technicians.length} techs · ${sc.jobs.length} jobs`;
  };
  on('scenario', sc => {
    mini.setScenario(sc, store.roads);
    chip(sc);
  });
  on('solution', sol => {
    mini.setScenario(sol.scenario, sol.roads);
    chip(sol.scenario);
    if (!fromLab) showFinal(sol);
  });
}

export function syncGaInputs() {
  sliders.forEach(([inp, , k]) => { $(inp).value = store.ga[k]; });
  syncers.forEach(s => s());
  $('#evo-seed').value = store.ga.seed;
}

async function run() {
  const btn = $('#evo-run');
  sliders.forEach(([inp, , k]) => { store.ga[k] = +$(inp).value; });
  store.ga.seed = +$('#evo-seed').value || 0;
  setLoading(btn, true);
  fromLab = true;
  try {
    animate(await solve());
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    fromLab = false;
    setLoading(btn, false);
  }
}

function series(sol) {
  const h = sol.history;
  return {
    best: h.map(x => x.best),
    mean: h.map(x => x.mean),
    worst: h.map(x => x.worst),
  };
}

function setCharts(sol, progress) {
  const s = series(sol);
  const b = sol.baseline.score;
  chart.set({
    series: [{ name: 'Best so far', values: s.best, color: '#5eead4', width: 3, area: true, head: true, glow: true }],
    ref: { y: b, label: `baseline ${fmt(b)}`, color: '#fb7185' },
    marks: sol.snapshots.map(x => ({ i: x.gen, v: x.score })),
    progress,
  });
  popChart.set({
    series: [
      { name: 'Worst', values: s.worst, color: 'rgba(251,113,133,.75)', width: 1.4, dash: '4 4' },
      { name: 'Mean', values: s.mean, color: '#a78bfa', width: 2 },
      { name: 'Best', values: s.best, color: '#5eead4', width: 1.6 },
    ],
    progress,
  });
}

function showSnapshot(sol, snap, flash) {
  mini.setRoutes(snap.routes, sol.paths);
  $('#evo-gen-badge').textContent = `gen ${snap.gen}`;
  renderChromo(sol, snap, flash);
}

function stat(gen, total, best, base, evals) {
  $('#evo-s-gen').innerHTML = `${gen}<span> / ${total}</span>`;
  $('#evo-s-best').textContent = fmt(best, 2);
  const imp = base ? (100 * (base - best)) / base : 0;
  $('#evo-s-imp').innerHTML = imp > 0.005 ? `<span class="grad-text" style="font-size:inherit;color:transparent">-${fmt(imp, 1)}%</span>` : '0%';
  $('#evo-s-evals').textContent = evals.toLocaleString();
}

function showFinal(sol) {
  lastChromo = null;
  const G = sol.history.length - 1;
  setCharts(sol);
  const last = sol.snapshots[sol.snapshots.length - 1];
  showSnapshot(sol, last, false);
  stat(G, G, sol.ga.score, sol.baseline.score, sol.evaluations);
  $('#evo-log').innerHTML = logRows(sol, sol.snapshots.length);
}

function logRows(sol, upto) {
  const b = sol.baseline.score;
  return sol.snapshots.slice(0, upto).reverse().map(s =>
    `<div><span class="mono">gen ${String(s.gen).padStart(3, ' ')}</span><span class="mono">${fmt(s.score, 2)}</span><span class="${s.score < b - 1e-6 ? 'badge good' : 'badge flat'}">${s.score < b - 1e-6 ? '-' + fmt((100 * (b - s.score)) / b, 1) + '%' : 'baseline'}</span></div>`).join('');
}

function animate(sol) {
  const id = ++runId;
  lastChromo = null;
  const G = sol.history.length - 1;
  const pop = sol.ga_config.population;
  const dur = Math.max(2600, Math.min(7000, G * 70));
  const t0 = performance.now();
  let shown = -1;
  setCharts(sol, 1);
  $('#evo-log').innerHTML = '';
  const step = now => {
    if (id !== runId) return;
    const k = Math.max(0, Math.min(G, Math.floor(((now - t0) / dur) * (G + 1))));
    setProgress(k);
    if (k < G) requestAnimationFrame(step);
    else {
      stat(G, G, sol.ga.score, sol.baseline.score, sol.evaluations);
      const lastGain = sol.snapshots[sol.snapshots.length - 1].gen;
      toast(`Evolution finished · best plan found at generation ${lastGain}`, 'ok');
    }
  };
  const setProgress = k => {
    chart.progress(k + 1);
    popChart.progress(k + 1);
    stat(k, G, sol.history[k].best, sol.baseline.score, Math.min(sol.evaluations, (k + 1) * pop));
    const idx = sol.snapshots.reduce((a, s, i) => (s.gen <= k ? i : a), 0);
    if (idx !== shown) {
      shown = idx;
      showSnapshot(sol, sol.snapshots[idx], true);
      $('#evo-log').innerHTML = logRows(sol, idx + 1);
    }
  };
  requestAnimationFrame(step);
}

function renderChromo(sol, snap, flash) {
  const served = new Set(snap.routes.flat());
  const { order, genes } = snap;
  const prev = lastChromo;
  const cell = (label, tech, isServed, changed, title) =>
    `<span class="cell ${isServed ? '' : 'unserved'} ${changed && flash ? 'flash' : ''}" style="--tc:${techColor(tech)}" title="${title}">${label}</span>`;
  const orderCells = order.map((j, i) => cell(`J${j}`, genes[j], served.has(j), prev && prev.order[i] !== j, `position ${i}: job ${j} → T${genes[j]}`)).join('');
  const geneCells = genes.map((t, j) => cell(`T${t}`, t, served.has(j), prev && prev.genes[j] !== t, `job ${j} assigned to technician ${t}`)).join('');
  $('#evo-chromo').innerHTML = `
    <div class="chromo-row"><div class="cap"><span>Gene block 1 · visit priority order (a permutation)</span><span class="mono">${order.length} genes</span></div><div class="cells">${orderCells}</div></div>
    <div class="chromo-row"><div class="cap"><span>Gene block 2 · technician for job 0, 1, 2 ...</span><span class="mono">${served.size}/${genes.length} served</span></div><div class="cells">${geneCells}</div></div>`;
  $('#evo-chromo-sub').textContent = `cost ${fmt(snap.score, 2)}`;
  lastChromo = { order: [...order], genes: [...genes] };
}
