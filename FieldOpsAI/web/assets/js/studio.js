import { $, $$, toast, icon, techColor, techName, skillChip, hhmm, fromHHMM, fmt, countUp, bindRange, setLoading } from './util.js';
import { store, on, generate, solve, setScenario, reasonFor } from './store.js';
import { CityMap } from './citymap.js';
import { syncGaInputs } from './evolution.js';

const DAY0 = 480, DAY1 = 1020;
let map;
let view = 'ga';
let playing = false;
let speed = 3;
let simTime = DAY0;
let lastTs = 0;
let mode = 'view';
let pendingNode = null;
let resolveTimer = null;
let edited = false;

const plan = () => store.solution?.[view];

export function initStudio() {
  map = new CityMap($('#st-canvas'), { pad: 34, padTop: 62 });
  map.unservedReason = j => reasonFor(j, plan());
  map.on('frame', tick)
    .on('road', toggleRoad)
    .on('node', openJobModal)
    .on('highlight', i => markRoster(i))
    .on('pick', hit => {
      if (hit.kind === 'tech') lockTech(hit.id);
      if (hit.kind === 'job') {
        const t = plan()?.techs.find(t => t.route.includes(hit.id));
        lockTech(t ? t.id : -1);
      }
    })
    .on('blank', () => lockTech(-1));

  const preset = $('#st-preset');
  preset.innerHTML = Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}">Report scenario ${i + 1} · seed ${1000 + i}</option>`).join('') + '<option value="0">Custom seed</option>';
  preset.addEventListener('change', () => {
    const n = +preset.value;
    store.preset = n;
    if (n) {
      $('#st-seed').value = 999 + n;
      $('#st-nt').value = 0; $('#st-nj').value = 0; $('#st-win').value = 'normal';
      syncNt(); syncNj();
      Object.assign(store.ga, { population: 36, generations: 50, mutation: 0.32, crossover: 0.8, seed: 50000 + (n - 1) * 7 });
      syncGaInputs();
      regenerate();
    }
  });
  $('#st-seed').value = 1000;
  $('#st-seed').addEventListener('input', () => { preset.value = '0'; store.preset = 0; });
  const auto = v => (v === 0 ? 'auto' : v);
  const syncNt = bindRange($('#st-nt'), $('#st-nt-o'), auto);
  const syncNj = bindRange($('#st-nj'), $('#st-nj-o'), auto);
  ['#st-nt', '#st-nj', '#st-win'].forEach(s => $(s).addEventListener('change', () => { preset.value = '0'; store.preset = 0; }));

  $('#st-generate').addEventListener('click', regenerate);
  $('#st-random').addEventListener('click', () => {
    $('#st-seed').value = Math.floor(Math.random() * 90000) + 2000;
    $('#st-nt').value = 3 + Math.floor(Math.random() * 4);
    $('#st-nj').value = 10 + Math.floor(Math.random() * 15);
    syncNt(); syncNj();
    preset.value = '0'; store.preset = 0;
    regenerate();
  });
  $('#st-optimize').addEventListener('click', optimize);

  $$('#st-view button').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
  $('#st-addjob').addEventListener('click', () => setMode(mode === 'job' ? 'view' : 'job'));
  $('#st-closeroad').addEventListener('click', () => setMode(mode === 'road' ? 'view' : 'road'));
  $('#st-reset').addEventListener('click', () => {
    if (!store.original) return;
    setScenario({ scenario: structuredClone(store.original), roads: store.roads.map(r => [r[0], r[1], r[2], false]) });
    edited = false;
    setMode('view');
    optimize();
  });

  $('#st-play').addEventListener('click', togglePlay);
  const slider = $('#st-time');
  bindRange(slider, null);
  slider.addEventListener('input', () => { pause(); simTime = +slider.value; map.time = simTime; paintTime(); });
  $$('#st-speed button').forEach(b => b.addEventListener('click', () => {
    $$('#st-speed button').forEach(x => x.classList.toggle('on', x === b));
    speed = +b.dataset.s;
  }));

  $$('#jm-skill button').forEach(b => b.addEventListener('click', () => $$('#jm-skill button').forEach(x => x.classList.toggle('on', x === b))));
  $('#jm-cancel').addEventListener('click', closeJobModal);
  $('#job-modal').addEventListener('click', e => { if (e.target.id === 'job-modal') closeJobModal(); });
  $('#jm-ok').addEventListener('click', addJob);

  document.addEventListener('keydown', e => {
    if (!$('#page-studio').classList.contains('active') || e.target.matches('input, select, textarea') || $('#job-modal').classList.contains('show')) return;
    if (e.key === 'o' || e.key === 'O') optimize();
    else if (e.key === 'g' || e.key === 'G') regenerate();
    else if (e.key === 'v' || e.key === 'V') setView(view === 'ga' ? 'baseline' : 'ga');
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Escape') setMode('view');
  });

  on('scenario', sc => {
    pause();
    simTime = DAY0;
    map.time = null;
    map.setScenario(sc, store.roads);
    paintTime();
    updateChip();
  });
  on('solution', sol => {
    map.setScenario(sol.scenario, sol.roads);
    map.setPlan(plan());
    renderAll(sol);
    updateChip();
  });
}

function updateChip() {
  const sc = store.scenario;
  if (!sc) return;
  const base = store.preset ? `Report scenario ${store.preset}` : 'Custom';
  $('#st-chip').innerHTML = `${icon('pin')}${base} · seed ${sc.road_seed} · ${sc.technicians.length} techs · ${sc.jobs.length} jobs · GA seed ${store.ga.seed}${edited ? ' · edited' : ''}`;
}

async function regenerate() {
  const nt = +$('#st-nt').value, nj = +$('#st-nj').value;
  const btn = $('#st-generate');
  setLoading(btn, true);
  try {
    edited = false;
    await generate({ seed: +$('#st-seed').value || 0, n_techs: nt || null, n_jobs: nj || null, windows: $('#st-win').value });
    await optimize();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setLoading(btn, false);
  }
}

export async function optimize() {
  const btn = $('#st-optimize');
  setLoading(btn, true);
  try {
    const sol = await solve();
    const b = sol.baseline, g = sol.ga;
    if (g.score < b.score - 1e-6) toast(`Genetic AI saved ${fmt(100 * (b.score - g.score) / b.score, 1)}% of the objective cost`, 'ok');
    else toast('GA matched the baseline: no cheaper plan exists in reach for this day', 'info');
  } catch (e) {
    toast(e.message + (e.details?.length ? `: ${e.details[0]}` : ''), 'err', 6000);
  } finally {
    setLoading(btn, false);
  }
}

function scheduleResolve(msg) {
  clearTimeout(resolveTimer);
  resolveTimer = setTimeout(async () => {
    try {
      const sol = await solve();
      toast(`${msg} · re-planned, GA cost ${fmt(sol.ga.score, 2)}`, 'ok');
    } catch (e) {
      toast(e.message + (e.details?.length ? `: ${e.details[0]}` : ''), 'err', 6000);
    }
  }, 180);
}

function setView(v) {
  view = v;
  $$('#st-view button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (!store.solution) return;
  map.setPlan(plan(), map.time == null);
  renderRoster(plan());
  renderUnserved(plan());
  renderGantt(plan());
}

function setMode(m) {
  mode = m;
  map.mode = m;
  map.hover = null;
  const wrap = $('#st-mapwrap');
  wrap.classList.toggle('edit-road', m === 'road');
  wrap.classList.toggle('edit-job', m === 'job');
  $('#st-closeroad').classList.toggle('on', m === 'road');
  $('#st-addjob').classList.toggle('on', m === 'job');
  $('#st-hint').textContent = m === 'road' ? 'Click a road to close or reopen it · Esc to finish' : m === 'job' ? 'Click an intersection to drop a new job · Esc to finish' : '';
}

function toggleRoad(u, v) {
  const sc = store.scenario;
  const k = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const idx = sc.closed_roads.findIndex(([a, b]) => k(a, b) === k(u, v));
  if (idx >= 0) sc.closed_roads.splice(idx, 1);
  else sc.closed_roads.push([u, v]);
  const road = store.roads.find(r => k(r[0], r[1]) === k(u, v));
  if (road) road[3] = idx < 0;
  edited = true;
  map.setScenario(sc, store.roads);
  map.setPlan(plan(), false);
  scheduleResolve(idx >= 0 ? `Road ${u}-${v} reopened` : `Road ${u}-${v} closed`);
}

function openJobModal(node) {
  pendingNode = node;
  $('#jm-node').textContent = `#${node}`;
  $('#job-modal').classList.add('show');
}

function closeJobModal() {
  $('#job-modal').classList.remove('show');
  pendingNode = null;
}

function addJob() {
  const start = fromHHMM($('#jm-start').value || '10:00');
  const end = fromHHMM($('#jm-end').value || '13:00');
  const duration = +$('#jm-dur').value;
  if (end <= start) return toast('Window end must be after window start', 'err');
  if (end - start < duration) return toast(`A ${duration}-minute job cannot fit in that window`, 'err');
  const skill = $('#jm-skill button.on').dataset.s;
  const sc = store.scenario;
  sc.jobs.push({ id: sc.jobs.length, node: pendingNode, skill, duration, start, end, priority: +$('#jm-pri').value });
  edited = true;
  closeJobModal();
  map.setScenario(sc, store.roads);
  scheduleResolve(`Job J${sc.jobs.length - 1} added`);
}

function lockTech(i) {
  map.lockHighlight = i >= 0;
  map.highlight = i;
  markRoster(i);
}

function markRoster(i) {
  $$('#st-roster .tech').forEach(el => el.classList.toggle('hl', +el.dataset.t === i));
}

function dayEnd() {
  const p = plan();
  if (!p) return DAY1;
  return Math.min(DAY1, Math.max(DAY0 + 60, ...p.techs.map(t => t.end)) + 15);
}

function togglePlay() {
  if (!store.solution) return;
  if (playing) return pause();
  if (simTime >= dayEnd() - 1) simTime = DAY0;
  playing = true;
  lastTs = performance.now();
  map.time = simTime;
  $('#st-play').innerHTML = icon('pause');
}

function pause() {
  playing = false;
  $('#st-play').innerHTML = icon('play');
}

function tick(now) {
  if (!playing) return;
  const dt = Math.min(0.1, (now - lastTs) / 1000);
  lastTs = now;
  simTime += dt * speed * 5;
  const end = dayEnd();
  if (simTime >= end) { simTime = end; pause(); }
  map.time = simTime;
  paintTime();
}

function paintTime() {
  const s = $('#st-time');
  s.value = simTime;
  s.style.setProperty('--fill', `${((simTime - DAY0) / (DAY1 - DAY0)) * 100}%`);
  $('#st-clock').innerHTML = `${hhmm(simTime)}<small>est.</small>`;
  const cur = $('#st-gantt .gantt-cursor');
  if (cur) cur.style.left = `${((simTime - DAY0) / (DAY1 - DAY0)) * 100}%`;
}

function renderAll(sol) {
  const w = sol.warning;
  $('#st-warning').classList.toggle('show', !!w);
  if (w) {
    $('#st-warning-msg').textContent = w.message;
    $('#st-warning-list').innerHTML = w.reasons.slice(0, 6).map(r => `<li>${r}</li>`).join('');
  }
  renderKpis(sol);
  renderBreakdown(sol);
  renderRoster(plan());
  renderUnserved(plan());
  renderGantt(plan());
  $('#st-runtime').textContent = `A* ${sol.astar.calls} paths · ${sol.astar.nodes_expanded} nodes`;
}

function delta(b, g, lowerBetter = true, d = 2, unit = '') {
  const diff = g - b;
  if (Math.abs(diff) < 1e-9) return `<span class="badge flat">${icon('minus')}0</span>`;
  const good = lowerBetter ? diff < 0 : diff > 0;
  const pct = b ? Math.abs(diff / b) * 100 : 0;
  const txt = unit === '%' || !b ? `${diff > 0 ? '+' : ''}${fmt(diff, d)}` : `${fmt(pct, 1)}%`;
  return `<span class="badge ${good ? 'good' : 'bad'}">${icon(diff < 0 ? 'arrowDown' : 'arrowUp')}${txt}</span>`;
}

function renderKpis(sol) {
  const b = sol.baseline, g = sol.ga;
  const imp = b.score ? (100 * (b.score - g.score)) / b.score : 0;
  const extra = g.served - b.served;
  $('#st-delta').innerHTML = `
    <div class="v grad-text" id="st-imp">0%</div>
    <div class="t">${imp > 0.005
      ? `Genetic AI lowers the objective from <b>${fmt(b.score)}</b> to <b>${fmt(g.score)}</b>${extra > 0 ? ` and serves <b>${extra} more job${extra > 1 ? 's' : ''}</b>` : ''}.`
      : `Both planners reach <b>${fmt(g.score)}</b>. The nearest-eligible plan is already the best one the GA found.`}</div>`;
  countUp($('#st-imp'), imp, { decimals: 1, suffix: '%', prefix: imp > 0.005 ? '-' : '' });
  const rows = [
    ['target', 'Objective', b.score, g.score, true, 2],
    ['ruler', 'Travel km', b.travel_km, g.travel_km, true, 2],
    ['package', 'Jobs served', b.served, g.served, false, 0, `/${b.total}`],
    ['hourglass', 'Waiting min', b.waiting_min, g.waiting_min, true, 0],
    ['clock', 'On-time rate', b.on_time_rate * 100, g.on_time_rate * 100, false, 0, '%'],
    ['alert', 'Violations', b.violations, g.violations, true, 0],
    ['timer', 'Runtime ms', b.runtime_ms, g.runtime_ms, true, 1],
  ];
  $('#st-kpis').innerHTML = `<div class="kpi-row head"><span>Metric</span><span style="text-align:right">Baseline</span><span style="text-align:right">GA</span><span>Δ</span></div>` +
    rows.map(([ic, name, bv, gv, lower, d, suf = '']) => `
      <div class="kpi-row"><span class="kpi-name">${icon(ic)}${name}</span>
      <span class="num">${fmt(bv, d)}${suf === '%' ? '%' : ''}</span><span class="num ga">${fmt(gv, d)}${suf}</span>
      <span>${name === 'Runtime ms' ? '<span class="badge flat">cost of search</span>' : delta(bv, gv, lower, d, suf === '%' ? '%' : '')}</span></div>`).join('');
}

function renderBreakdown(sol) {
  const parts = [['travel', '#38bdf8', 'Travel units'], ['unserved', '#fb7185', '42 × unserved penalty'], ['waiting', '#fbbf24', '0.025 × waiting']];
  const max = Math.max(sol.baseline.score, sol.ga.score) || 1;
  const row = (label, p) => `<div class="bd-row"><span class="dim">${label}</span><div class="bar">${parts.map(([k, c]) =>
    `<i style="width:0;background:${c}" data-w="${(p.breakdown[k] / max) * 100}"></i>`).join('')}</div><span class="tot">${fmt(p.score, 1)}</span></div>`;
  $('#st-breakdown').innerHTML = row('Baseline', sol.baseline) + row('Genetic AI', sol.ga) +
    `<div class="bd-legend">${parts.map(([, c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => $$('#st-breakdown .bar i').forEach(i => { i.style.width = i.dataset.w + '%'; })));
}

function renderRoster(p) {
  if (!p) return;
  const sc = store.scenario;
  const minPerUnit = store.meta?.min_per_unit || 1.6;
  $('#st-roster-sub').textContent = `${p.techs.filter(t => t.route.length).length}/${p.techs.length} active`;
  $('#st-roster').innerHTML = p.techs.map(t => {
    const tech = sc.technicians[t.id];
    const span = tech.shift_end - tech.shift_start;
    const travel = t.legs.reduce((s, l) => s + l.units * minPerUnit, 0);
    const pc = v => `${Math.max(0, (v / span) * 100)}%`;
    const chips = t.route.length
      ? `<span class="home"></span>` + t.route.map(j => `<span class="arr">→</span><span class="j">J${j}</span>`).join('')
      : '<span class="dim">Idle today: no feasible job in reach</span>';
    return `<div class="tech" data-t="${t.id}" style="--tc:${techColor(t.id)}">
      <div class="tech-top"><span class="av">${icon('truck')}</span>
        <div><b>T${t.id} · ${techName(t.id)}</b><small>${tech.skills.join(' · ')}</small></div>
        <div class="km">${fmt(t.km, 1)}<small class="dim"> km</small><small>${t.route.length} job${t.route.length === 1 ? '' : 's'}</small></div></div>
      <div class="route-chips">${chips}</div>
      <div class="util"><span>Day</span><div class="track">
        <i style="width:${pc(travel)};background:${techColor(t.id)};opacity:.5" title="travel"></i>
        <i style="width:${pc(t.wait_min)};background:rgba(148,163,184,.35)" title="waiting"></i>
        <i style="width:${pc(t.service_min)};background:${techColor(t.id)}" title="on site"></i></div>
        <span class="mono">${Math.round(((travel + t.service_min) / span) * 100)}%</span></div>
    </div>`;
  }).join('');
  $$('#st-roster .tech').forEach(el => {
    el.addEventListener('mouseenter', () => { if (!map.lockHighlight) map.highlight = +el.dataset.t; });
    el.addEventListener('mouseleave', () => { if (!map.lockHighlight) map.highlight = -1; });
    el.addEventListener('click', () => lockTech(map.lockHighlight && map.highlight === +el.dataset.t ? -1 : +el.dataset.t));
  });
}

function renderUnserved(p) {
  if (!p) return;
  $('#st-unserved-sub').textContent = `${p.unserved.length} of ${p.total}`;
  $('#st-unserved').innerHTML = p.unserved.length
    ? p.unserved.map(u => {
      const job = store.scenario.jobs[u.job];
      return `<div class="unserved">${icon('alert')}<div><b>J${u.job}</b> ${skillChip(job.skill)} <span class="dim mono">${hhmm(job.start)}-${hhmm(job.end)}</span><div class="muted" style="margin-top:4px">${u.reason}</div></div></div>`;
    }).join('')
    : `<div class="empty-ok">${icon('checkCircle')}Every job has a feasible technician and time slot.</div>`;
}

function renderGantt(p) {
  if (!p) return;
  const pos = m => `${((m - DAY0) / (DAY1 - DAY0)) * 100}%`;
  const wid = (a, b) => `${(Math.max(0, b - a) / (DAY1 - DAY0)) * 100}%`;
  const rows = p.techs.map(t => {
    const segs = t.legs.map(l => `
      <div class="gseg travel" style="left:${pos(l.depart)};width:${wid(l.depart, l.arrival)}" title="J${l.job}: travel ${hhmm(l.depart)}-${hhmm(l.arrival)}"></div>
      <div class="gseg wait" style="left:${pos(l.arrival)};width:${wid(l.arrival, l.begin)}" title="J${l.job}: waiting ${Math.round(l.wait)} min"></div>
      <div class="gseg service" style="left:${pos(l.begin)};width:${wid(l.begin, l.finish)}" title="J${l.job}: on site ${hhmm(l.begin)}-${hhmm(l.finish)}">J${l.job}</div>`).join('');
    return `<div class="gantt-row" style="--tc:${techColor(t.id)}"><div class="who"><i style="background:${techColor(t.id)}"></i>T${t.id} ${techName(t.id)}</div><div class="gantt-track">${segs}</div></div>`;
  }).join('');
  const ticks = Array.from({ length: 10 }, (_, i) => `<span style="left:${(i / 9) * 100}%">${String(8 + i).padStart(2, '0')}:00</span>`).join('');
  $('#st-gantt').innerHTML = `<div style="position:relative">${rows}<div style="position:absolute;top:0;bottom:0;left:108px;right:0;pointer-events:none"><div class="gantt-cursor" style="left:${pos(simTime)}"></div></div></div>
    <div class="gantt-axis"><span></span><div class="ticks">${ticks}</div></div>`;
}
