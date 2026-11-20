import { api } from './util.js';

const subs = {};

export const store = {
  meta: null,
  scenario: null,
  roads: [],
  solution: null,
  original: null,
  preset: 1,
  ga: { population: 36, generations: 50, mutation: 0.32, crossover: 0.8, seed: 50000 },
};

export function on(event, fn) {
  (subs[event] ||= []).push(fn);
}

export function emit(event, data) {
  (subs[event] || []).forEach(fn => fn(data));
}

export function setScenario(payload, { keepOriginal = false } = {}) {
  store.scenario = payload.scenario;
  store.roads = payload.roads;
  store.solution = null;
  if (!keepOriginal) store.original = structuredClone(payload.scenario);
  emit('scenario', store.scenario);
}

export async function generate(params) {
  const data = await api('/api/scenario', params);
  setScenario(data);
  return data;
}

export async function solve() {
  const data = await api('/api/solve', { scenario: store.scenario, ga: store.ga });
  store.solution = data;
  store.scenario = data.scenario;
  store.roads = data.roads;
  emit('solution', data);
  return data;
}

export function reasonFor(jobId, plan) {
  return plan?.unserved.find(u => u.job === jobId)?.reason;
}
