import random
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class Plan:
    method: str
    order: list
    genes: list
    result: dict
    runtime_ms: float = 0.0
    history: list = field(default_factory=list)
    snapshots: list = field(default_factory=list)

    @property
    def score(self):
        return self.result["score"]

    @property
    def trace(self):
        return [h["best"] for h in self.history]


class Planner(ABC):
    name = "planner"

    @abstractmethod
    def optimize(self, evaluator, initial=None):
        ...


class NearestEligibleDispatcher(Planner):
    name = "nearest-eligible"

    def optimize(self, ev, initial=None):
        t0 = time.perf_counter()
        jobs, techs = ev.jobs, ev.techs
        states = [(t.start_node, t.shift_start) for t in techs]
        genes = [0] * len(jobs)
        order = []
        remaining = set(range(len(jobs)))

        while remaining:
            jid = min(remaining, key=lambda x: (jobs[x].end, jobs[x].start, x))
            remaining.remove(jid)
            order.append(jid)
            job = jobs[jid]

            options = []
            for ti, tech in enumerate(techs):
                loc, now = states[ti]
                step = ev.check.try_append(tech, loc, now, job)
                if step:
                    options.append((step[2], ti, step))

            if options:
                _, ti, step = min(options, key=lambda o: (o[0], o[1]))
                genes[jid] = ti
                states[ti] = (step[0], step[1])
            else:
                able = [i for i, t in enumerate(techs) if t.can_perform(job)]
                genes[jid] = able[0] if able else 0

        result = ev.evaluate(order, genes)
        return Plan(self.name, order, genes, result, (time.perf_counter() - t0) * 1000)


class GeneticOptimizer(Planner):
    name = "genetic-optimizer"

    def __init__(self, population=36, generations=50, mutation=.32, crossover=.8, elite=3, tournament=3, seed=None):
        self.population = population
        self.generations = generations
        self.mutation_rate = mutation
        self.crossover_rate = crossover
        self.elite = elite
        self.tournament = tournament
        self.seed = seed
        self.rng = random.Random(seed)
        self.compatible = []

    def random_individual(self, n):
        order = list(range(n))
        self.rng.shuffle(order)
        genes = [self.rng.choice(self.compatible[j]) for j in range(n)]
        return order, genes

    def mutate(self, chrom):
        rng = self.rng
        order, genes = chrom[0][:], chrom[1][:]
        n = len(order)
        if rng.random() < .75:
            i, j = rng.sample(range(n), 2)
            order[i], order[j] = order[j], order[i]
        else:
            i, j = sorted(rng.sample(range(n), 2))
            order[i:j + 1] = reversed(order[i:j + 1])
        for _ in range(1 if rng.random() < .7 else 2):
            k = rng.randrange(n)
            genes[k] = rng.choice(self.compatible[k])
        return order, genes

    def crossover(self, a, b):
        rng = self.rng
        n = len(a[0])
        cut1, cut2 = sorted(rng.sample(range(n), 2))
        child = [None] * n
        child[cut1:cut2] = a[0][cut1:cut2]
        kept = set(child[cut1:cut2])
        rest = iter([g for g in b[0] if g not in kept])
        for k in range(n):
            if child[k] is None:
                child[k] = next(rest)
        genes = [a[1][j] if rng.random() < .5 else b[1][j] for j in range(n)]
        return child, genes

    def select(self, ranked):
        picks = [self.rng.choice(ranked) for _ in range(self.tournament)]
        return min(picks, key=lambda row: row[0])[1]

    def optimize(self, ev, initial=None):
        t0 = time.perf_counter()
        self.rng = random.Random(self.seed)
        n = len(ev.jobs)
        self.compatible = [[i for i, t in enumerate(ev.techs) if t.can_perform(j)] or [0] for j in ev.jobs]
        if initial is None:
            initial = NearestEligibleDispatcher().optimize(ev)

        if n < 2:
            hist = [{"gen": 0, "best": initial.score, "mean": initial.score, "worst": initial.score}]
            return Plan(self.name, initial.order[:], initial.genes[:], initial.result,
                        (time.perf_counter() - t0) * 1000, hist, [(0, initial.score, initial.order[:], initial.genes[:])])

        pop = [(initial.order[:], initial.genes[:])]
        for x in range(self.population - 1):
            pop.append(self.mutate(pop[0]) if x < self.population // 3 else self.random_individual(n))

        best = None
        history, snapshots = [], []
        for gen in range(self.generations + 1):
            ranked = sorted(((ev.score(*p), p) for p in pop), key=lambda r: r[0])
            if best is None or ranked[0][0] < best[0]:
                best = ranked[0]
                snapshots.append((gen, best[0], best[1][0][:], best[1][1][:]))
            scores = [r[0] for r in ranked]
            history.append({"gen": gen, "best": best[0], "mean": sum(scores) / len(scores), "worst": scores[-1]})
            if gen == self.generations:
                break

            nxt = [(p[0][:], p[1][:]) for _, p in ranked[:self.elite]]
            while len(nxt) < self.population:
                a, b = self.select(ranked), self.select(ranked)
                kid = self.crossover(a, b) if self.rng.random() < self.crossover_rate else (a[0][:], a[1][:])
                if self.rng.random() < self.mutation_rate:
                    kid = self.mutate(kid)
                nxt.append(kid)
            pop = nxt

        order, genes = best[1]
        result = ev.evaluate(order, genes)
        return Plan(self.name, order, genes, result, (time.perf_counter() - t0) * 1000, history, snapshots)
