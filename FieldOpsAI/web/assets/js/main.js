import { $, $$, api, toast, hydrateIcons } from './util.js';
import { store, generate, solve } from './store.js';
import { initOverview, startHero } from './overview.js';
import { initStudio } from './studio.js';
import { initEvolution } from './evolution.js';
import { initSearchLab, showSearchLab } from './searchlab.js';
import { initExperiments, loadExperiments } from './experiments.js';
import { initData } from './data.js';

const PAGES = ['overview', 'studio', 'evolution', 'search', 'experiments', 'data'];

function route() {
  const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  window.scrollTo({ top: 0 });
  if (page === 'search') showSearchLab();
  if (page === 'experiments') loadExperiments();
  requestAnimationFrame(revealVisible);
}

const io = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.12 });

function revealVisible() {
  $$('.page.active .reveal:not(.in)').forEach(el => io.observe(el));
}

async function boot() {
  hydrateIcons();
  initStudio();
  initEvolution();
  initSearchLab();
  initExperiments();
  initData();

  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = +e.key;
    if (n >= 1 && n <= PAGES.length) location.hash = PAGES[n - 1];
  });

  try {
    store.meta = await api('/api/meta');
  } catch (e) {
    $('#engine-status').textContent = 'Engine offline';
    $('.side-foot .pulse-dot').style.background = '#fb7185';
    toast(e.message, 'err', 8000);
  }

  let bench = null;
  try { bench = await loadExperiments(); } catch { bench = null; }
  initOverview(bench);
  route();

  try {
    await generate({ seed: 1000 });
    const first = await solve();
    startHero(structuredClone(first));
  } catch (e) {
    toast(e.message, 'err', 8000);
  }
  setTimeout(() => $('#splash').classList.add('gone'), 250);
  revealVisible();
}

boot();
