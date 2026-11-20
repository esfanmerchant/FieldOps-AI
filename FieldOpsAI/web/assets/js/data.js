import { $, $$, api, toast, icon, techColor, techName, skillChip, hhmm, downloadJSON } from './util.js';
import { store, on, setScenario, solve } from './store.js';

export function initData() {
  const drop = $('#dt-drop');
  const file = $('#dt-file');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', () => { if (file.files[0]) readFile(file.files[0]); file.value = ''; });

  $('#dt-sample').addEventListener('click', () => loadSample('sample_scenario.json'));
  $('#dt-broken').addEventListener('click', () => loadSample('broken_scenario.json'));
  $('#dt-download').addEventListener('click', () => {
    if (store.scenario) downloadJSON(store.scenario, `fieldops_scenario_${store.scenario.road_seed}.json`);
  });

  on('scenario', () => renderTables());
  on('solution', () => renderTables());
}

async function loadSample(name) {
  try {
    const res = await fetch(`samples/${name}`);
    if (!res.ok) throw new Error(`Sample file ${name} is missing from the data folder`);
    await importText(await res.text(), name);
  } catch (e) {
    showResult(false, e.message, []);
  }
}

function readFile(f) {
  const r = new FileReader();
  r.onload = () => importText(r.result, f.name);
  r.onerror = () => showResult(false, `Could not read ${f.name}`, []);
  r.readAsText(f);
}

async function importText(text, name) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return showResult(false, `${name} is not valid JSON`, [e.message]);
  }
  let payload;
  try {
    payload = await api('/api/validate', obj);
  } catch (e) {
    return showResult(false, `${name} was rejected: ${e.message}`, e.details);
  }
  if (!payload.ok) return showResult(false, `${name} was rejected: ${payload.error}`, payload.details);
  store.preset = 0;
  setScenario(payload);
  showResult(true, `${name} is valid`, [`${payload.scenario.technicians.length} technicians and ${payload.scenario.jobs.length} jobs loaded into Dispatch Studio`]);
  toast(`Loaded ${name}`, 'ok');
  try {
    await solve();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function showResult(ok, title, lines = []) {
  lines = lines || [];
  const el = $('#dt-result');
  el.className = `val-result ${ok ? 'ok' : 'err'}`;
  el.innerHTML = `<b style="display:flex;gap:8px;align-items:center">${icon(ok ? 'checkCircle' : 'alert')}${title}</b>${lines.length ? `<ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>` : ''}`;
  el.querySelector('svg').setAttribute('width', 17);
  el.querySelector('svg').style.color = ok ? '#4ade80' : '#fb7185';
}

function renderTables() {
  const sc = store.scenario;
  if (!sc) return;
  const plan = store.solution?.ga;
  const owner = new Map();
  plan?.techs.forEach(t => t.legs.forEach(l => owner.set(l.job, { t: t.id, l })));
  const unserved = new Map((plan?.unserved || []).map(u => [u.job, u.reason]));

  $('#dt-tech-sub').textContent = `${sc.technicians.length} records`;
  $('#dt-techs').innerHTML = `<table class="data"><thead><tr><th>ID</th><th>Name</th><th class="n">Depot</th><th>Skills</th><th>Shift</th><th class="n">GA jobs</th></tr></thead><tbody>${
    sc.technicians.map((t, i) => `<tr><td><b style="color:${techColor(i)}" class="mono">T${i}</b></td><td>${techName(i)}</td><td class="n">${t.start_node}</td>
      <td><div style="display:flex;gap:4px">${t.skills.map(skillChip).join('')}</div></td><td class="mono">${hhmm(t.shift_start)}-${hhmm(t.shift_end)}</td>
      <td class="n">${plan ? plan.techs[i].route.length : '-'}</td></tr>`).join('')}</tbody></table>`;

  $('#dt-job-sub').textContent = `${sc.jobs.length} records${plan ? ` · ${plan.served} served by GA` : ''}`;
  $('#dt-jobs').innerHTML = `<table class="data"><thead><tr><th>ID</th><th class="n">Node</th><th>Skill</th><th class="n">Min</th><th>Window</th><th class="n">Priority</th><th>GA assignment</th><th></th></tr></thead><tbody>${
    sc.jobs.map((j, i) => {
      const o = owner.get(i);
      const status = o
        ? `<span class="mono" style="color:${techColor(o.t)}">T${o.t} · ${hhmm(o.l.begin)}</span>`
        : plan ? `<span style="color:#fb7185" title="${unserved.get(i) || ''}">unassigned</span>` : '-';
      return `<tr><td class="mono"><b>J${i}</b></td><td class="n">${j.node}</td><td>${skillChip(j.skill)}</td><td class="n">${j.duration}</td>
        <td class="mono">${hhmm(j.start)}-${hhmm(j.end)}</td><td class="n">${j.priority}</td><td>${status}</td>
        <td><button class="btn btn-sm btn-icon btn-ghost" data-del="${i}" title="Remove job">${icon('trash')}</button></td></tr>`;
    }).join('')}</tbody></table>`;

  $$('#dt-jobs [data-del]').forEach(b => b.addEventListener('click', async () => {
    const i = +b.dataset.del;
    if (sc.jobs.length <= 1) return toast('A scenario needs at least one job', 'err');
    sc.jobs.splice(i, 1);
    sc.jobs.forEach((j, k) => { j.id = k; });
    setScenario({ scenario: sc, roads: store.roads }, { keepOriginal: true });
    try {
      await solve();
      toast(`Removed J${i} and re-planned`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }));
}
