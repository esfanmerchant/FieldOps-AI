import { $, $$, api, toast, icon, fmt, countUp, setLoading } from './util.js';
import { store } from './store.js';
import { LineChart, groupedBars, heatmap, sparkline } from './charts.js';

let data = null;
let filter = 'all';
let sortKey = 'scenario';
let sortDir = 1;
let conv;

export function initExperiments() {
  conv = new LineChart($('#ex-conv'), { height: 280, yLabel: 'Mean best-so-far cost' });
  $('#ex-run').addEventListener('click', rerun);
  $$('#ex-filter button').forEach(b => b.addEventListener('click', () => {
    $$('#ex-filter button').forEach(x => x.classList.toggle('on', x === b));
    filter = b.dataset.f;
    renderTable();
  }));
}

export async function loadExperiments(force = false) {
  if (data && !force) return data;
  try {
    data = await api('/api/experiments');
    render();
  } catch (e) {
    $('#ex-match').className = 'match-banner off';
    $('#ex-match').innerHTML = `${icon('alert')}<div><b>No saved benchmark yet</b><span>Press "Re-run benchmark" to generate results (takes a few seconds).</span></div>`;
  }
  return data;
}

async function rerun() {
  const btn = $('#ex-run');
  setLoading(btn, true);
  $('#ex-progress').classList.add('show');
  const t0 = performance.now();
  try {
    data = await api('/api/experiments/run', {});
    render();
    toast(`Benchmark finished in ${fmt((performance.now() - t0) / 1000, 1)} s: 20 scenarios, 60 runs`, 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setLoading(btn, false);
    $('#ex-progress').classList.remove('show');
  }
}

function render() {
  const s = data.summary;
  const rep = store.meta?.report;
  const same = rep && Math.abs(s.baseline.score - rep.baseline_cost) < 0.006 && Math.abs(s.ga.score - rep.ga_cost) < 0.006 &&
    Math.abs(s.objective_improvement_pct - rep.improvement_pct) < 0.006 && s.ga_improved_objective_trials === rep.improved;
  const m = $('#ex-match');
  m.className = `match-banner${same ? '' : ' off'}`;
  m.innerHTML = same
    ? `${icon('shield')}<div><b>Matches the submitted report (Table 6.2) exactly</b><span>Objective ${fmt(s.baseline.score)} → ${fmt(s.ga.score)} · ${fmt(s.objective_improvement_pct)}% lower cost · travel ${fmt(s.baseline.travel_km)} → ${fmt(s.ga.travel_km)} km · GA better in ${s.ga_improved_objective_trials}/40 runs, tied in ${s.ga_equal_objective_trials}. Runtime depends on the machine.</span></div>`
    : `${icon('alert')}<div><b>Results differ from the report</b><span>Check the GA parameters and seeds used for this run.</span></div>`;

  const curves = data.curves;
  const meanCurve = curves[0].map((_, g) => curves.reduce((a, c) => a + c[g], 0) / curves.length);
  const cards = [
    ['target', 'Mean objective (GA)', s.ga.score, 2, '', `baseline ${fmt(s.baseline.score)}`, `-${fmt(s.objective_improvement_pct)}%`, sparkline(meanCurve, '#5eead4')],
    ['ruler', 'Mean travel (GA)', s.ga.travel_km, 2, ' km', `baseline ${fmt(s.baseline.travel_km)} km`, `-${fmt(s.travel_reduction_pct, 1)}%`],
    ['package', 'Mean jobs served (GA)', s.ga.served, 2, '', `baseline ${fmt(s.baseline.served)}`, `+${fmt(s.ga.served - s.baseline.served)}`],
    ['trophy', 'GA runs better', s.ga_improved_objective_trials, 0, ` / ${s.n_ga_trials}`, `${s.ga_equal_objective_trials} tied · ${s.ga_worse_objective_trials ?? 0} worse`, '0 violations'],
  ];
  $('#ex-stats').innerHTML = cards.map(([ic, label, v, d, suf, foot, badge, spark], i) => `
    <div class="card stat">${spark ? `<span class="spark">${spark}</span>` : ''}
      <div class="label">${icon(ic)}${label}</div>
      <div class="value"><span data-c="${i}">0</span><small>${suf}</small></div>
      <div class="foot"><span class="badge good">${badge}</span>${foot}</div></div>`).join('');
  cards.forEach(([, , v, d], i) => countUp($(`[data-c="${i}"]`, $('#ex-stats')), v, { decimals: d, duration: 1100 }));

  const rows = data.rows;
  const base = rows.filter(r => r.algorithm === 'nearest-eligible');
  const ga = rows.filter(r => r.algorithm === 'genetic-optimizer');
  const ids = base.map(r => r.scenario);
  const gaMean = ids.map(id => { const g = ga.filter(r => r.scenario === id); return g.reduce((a, r) => a + r.score, 0) / g.length; });
  groupedBars($('#ex-bars'), {
    categories: ids,
    series: [
      { name: 'Nearest-eligible baseline', color: '#475a80', values: base.map(r => r.score) },
      { name: 'Genetic optimizer', color: '#5eead4', values: gaMean },
    ],
    yLabel: 'Objective cost',
  });

  conv.set({
    series: [{ name: 'Mean best cost', values: meanCurve, color: '#5eead4', width: 3, area: true, glow: true }],
    labels: [
      { i: 0, v: meanCurve[0], text: fmt(meanCurve[0], 1), dx: 18, dy: -10 },
      { i: meanCurve.length - 1, v: meanCurve[meanCurve.length - 1], text: fmt(meanCurve[meanCurve.length - 1], 1), dx: -16, dy: -12 },
    ],
  });

  const trials = [0, 1].map(k => ids.map(id => {
    const b = base.find(r => r.scenario === id).score;
    const g = ga.filter(r => r.scenario === id)[k];
    return (100 * (b - g.score)) / b;
  }));
  heatmap($('#ex-heat'), { rows: ['GA seed A', 'GA seed B'], cols: ids, values: trials });

  renderTable();

  const info = data.info || {};
  const items = [
    ['Python', info.python], ['Platform', info.platform], ['Created', info.created],
    ['Scenario seeds', info.scenario_seeds ? `${info.scenario_seeds[0]} - ${info.scenario_seeds[info.scenario_seeds.length - 1]}` : '-'],
    ['GA seeds', info.optimization_seeds], ['Benchmark time', info.total_seconds != null ? `${info.total_seconds} s` : '-'],
    ['GA config', info.ga ? Object.entries(info.ga).map(([k, v]) => `${k} ${v}`).join(' · ') : '-'],
    ['Objective', info.objective], ['Travel', `${info.distance_km || ''}; ${info.travel_time || ''}`],
  ];
  $('#ex-info').innerHTML = items.map(([k, v]) => `<div${k === 'GA config' || k === 'Objective' || k === 'Travel' ? ' style="grid-column:1/-1"' : ''}><small>${k}</small><b>${v ?? '-'}</b></div>`).join('');
}

const COLS = [
  ['scenario', 'Scn', 1], ['scenario_seed', 'Seed', 1], ['algorithm', 'Algorithm', 0], ['optimizer_seed', 'GA seed', 1],
  ['jobs', 'Jobs', 1], ['technicians', 'Techs', 1], ['served', 'Served', 1], ['travel_km', 'Travel km', 1],
  ['waiting_min', 'Wait min', 1], ['score', 'Cost', 1], ['runtime_ms', 'ms', 1],
];

function renderTable() {
  if (!data) return;
  let rows = data.rows.filter(r => filter === 'all' || r.algorithm === filter);
  rows = [...rows].sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir);
  const cell = (r, [k, , n]) => {
    if (k === 'algorithm') return `<td><span class="algo-tag ${r[k] === 'nearest-eligible' ? 'base' : 'ga'}">${r[k] === 'nearest-eligible' ? 'baseline' : 'GA'}</span></td>`;
    const v = r[k];
    return `<td class="${n ? 'n' : ''}">${typeof v === 'number' && !Number.isInteger(v) ? fmt(v, 2) : v}</td>`;
  };
  $('#ex-table').innerHTML = `<table class="data"><thead><tr>${COLS.map(([k, l, n]) => `<th class="${n ? 'n' : ''}" data-k="${k}">${l}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${COLS.map(c => cell(r, c)).join('')}</tr>`).join('')}</tbody></table>`;
  $$('#ex-table th').forEach(th => th.addEventListener('click', () => {
    if (sortKey === th.dataset.k) sortDir *= -1; else { sortKey = th.dataset.k; sortDir = 1; }
    renderTable();
  }));
}
