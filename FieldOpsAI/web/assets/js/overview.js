import { $, api, icon, fmt, countUp, hhmm } from './util.js';
import { CityMap } from './citymap.js';
import { sparkline } from './charts.js';

const STEPS = [
  ['database', 'Synthetic records', 'Jobs, technicians, seeds', 'environment.py', 'data'],
  ['shield', 'Validation', 'Skills, shifts, windows', 'models.py', 'data'],
  ['network', 'Road graph + A*', 'Pairwise travel costs', 'search.py', 'search'],
  ['ban', 'Constraint checker', 'Reject impossible visits', 'environment.py', 'studio'],
  ['target', 'Nearest-eligible', 'Baseline assignment', 'agents.py', 'studio'],
  ['dna', 'Genetic optimizer', 'Reassign + reorder', 'agents.py', 'evolution'],
  ['gauge', 'Schedule evaluator', 'Feasibility + objective', 'environment.py', 'studio'],
  ['flask', 'Experiments', 'CSV, charts, dashboard', 'experiments.py', 'experiments'],
];

const ENGINES = [
  {
    icon: 'network', color: '#38bdf8', title: 'A* route search',
    text: 'Finds the cheapest road path between every pair of locations on the weighted grid and caches it, so both planners share identical travel costs.',
    code: 'f(n) = g(n) + h(n)\nh(n) = |Δrow| + |Δcol|   (edge ≥ 1, admissible)',
    who: ['AJ', 'Amaan Jilani', '#38bdf8'], link: '#search',
  },
  {
    icon: 'shield', color: '#5eead4', title: 'Constraints + evaluator',
    text: 'Accepts a visit only if the technician has the skill, can reach the job and finish inside both the appointment window and the shift.',
    code: 'cost = travel + 42 × Σ priority_weight(unserved)\n     + 0.025 × waiting_minutes',
    who: ['AR', 'Ahmed Raza', '#5eead4'], link: '#studio',
  },
  {
    icon: 'dna', color: '#a78bfa', title: 'Genetic algorithm',
    text: 'Evolves visit orders and job-to-technician genes, seeded from the baseline, using tournament selection, order crossover, mutation and elitism.',
    code: 'population 36 · generations 50\ncrossover 0.80 · mutation 0.32 · elite 3',
    who: ['EM', 'Esfan Merchant', '#a78bfa'], link: '#evolution',
  },
];

const TEAM = [
  ['AR', 'Ahmed Raza', '24K-2515 · Leader', 'Data models, constraint checks, evaluator and integration', ['models.py', 'environment.py', 'main.py', 'server.py'], '#5eead4'],
  ['AJ', 'Amaan Jilani', '24K-2540', 'Road graph, A* routing and route-cost validation', ['search.py', 'Search Lab'], '#38bdf8'],
  ['EM', 'Esfan Merchant', '24K-2546', 'Genetic algorithm, experiments and dashboard', ['agents.py', 'experiments.py', 'figures.py', 'web/'], '#a78bfa'],
];

export async function initOverview(summary) {
  $('#pipeline').innerHTML = STEPS.map(([ic, t, s, f, page]) => `
    <a class="pipe-step" href="#${page}"><span class="node">${icon(ic)}</span><b>${t}</b><small>${s}</small><span class="owner">${f}</span></a>`).join('');

  $('#engines').innerHTML = ENGINES.map(e => `
    <a class="card algo-card reveal" href="${e.link}">
      <div class="ico" style="background:${e.color}22;color:${e.color}">${icon(e.icon)}</div>
      <h3>${e.title}</h3><p>${e.text}</p><code>${e.code.replace(/\n/g, '<br>')}</code>
      <div class="who"><span class="avatar" style="background:${e.who[2]}">${e.who[0]}</span>${e.who[1]}</div>
    </a>`).join('');

  $('#team').innerHTML = TEAM.map(([ini, name, roll, role, files, c]) => `
    <div class="card member reveal"><span class="avatar" style="background:linear-gradient(135deg,${c},#a78bfa)">${ini}</span>
      <div><h4>${name}</h4><div class="role">${roll}</div><div class="muted" style="font-size:13px;margin-bottom:10px">${role}</div>
      <div class="files">${files.map(f => `<span>${f}</span>`).join('')}</div></div></div>`).join('');

  renderStats(summary);
}

function renderStats(data) {
  const s = data?.summary;
  const curves = data?.curves;
  const imp = s ? s.objective_improvement_pct : 20.44;
  const trv = s ? s.travel_reduction_pct : 6.0;
  const won = s ? s.ga_improved_objective_trials : 37;
  const tied = s ? s.ga_equal_objective_trials : 3;
  const mean = curves ? curves[0].map((_, g) => curves.reduce((a, c) => a + c[g], 0) / curves.length) : null;
  const cards = [
    ['trending', 'Lower objective cost', imp, 2, '%', `GA ${fmt(s?.ga.score ?? 54.69)} vs baseline ${fmt(s?.baseline.score ?? 68.74)}`, mean && sparkline(mean, '#5eead4')],
    ['ruler', 'Less travel', trv, 1, '%', `${fmt(s?.baseline.travel_km ?? 35.87)} → ${fmt(s?.ga.travel_km ?? 33.71)} km per day`],
    ['trophy', 'GA runs better', won, 0, '/40', `${tied} tied · 0 worse than baseline`],
    ['shield', 'Hard violations', 0, 0, '', 'across all 60 runs · 100% on time'],
  ];
  $('#ov-stats').innerHTML = cards.map(([ic, label, , , suf, foot, spark], i) => `
    <div class="card stat reveal">${spark ? `<span class="spark">${spark}</span>` : ''}
      <div class="label">${icon(ic)}${label}</div>
      <div class="value"><span class="grad-text" data-o="${i}">0</span><small>${suf}</small></div>
      <div class="foot">${foot}</div></div>`).join('');
  cards.forEach(([, , v, d], i) => countUp($(`[data-o="${i}"]`), v, { decimals: d, duration: 1400 }));
}

export async function startHero(first) {
  const map = new CityMap($('#hero-canvas'), { pad: 30, padTop: 34, padBottom: 62 });
  try {
    const sol = first || await api('/api/solve', { scenario: (await api('/api/scenario', { seed: 1000 })).scenario });
    map.setScenario(sol.scenario, sol.roads);
    map.setPlan(sol.ga);
    map.unservedReason = () => '';
    const end = Math.max(...sol.ga.techs.map(t => t.end)) + 20;
    let t = 480, last = 0, hold = 0;
    map.on('frame', now => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (hold > 0) {
        hold -= dt;
        if (hold <= 0) { t = 480; map.startReveal(1400); }
        return;
      }
      if (map.reveal < 1) { map.time = null; return; }
      t += dt * 32;
      if (t >= end) { t = end; hold = 2.2; }
      map.time = t;
      $('#hero-clock').textContent = hhmm(t);
    });
  } catch {
    $('#hero-tag').textContent = 'engine offline';
  }
}
