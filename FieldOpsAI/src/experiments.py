import csv
import json
import platform
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

from .agents import NearestEligibleDispatcher, GeneticOptimizer
from .environment import generate_scenario, KM_PER_UNIT, SPEED_KMH, UNSERVED_PENALTY, WAIT_WEIGHT

ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = ROOT / "results"

GA_DEFAULTS = {"population": 36, "generations": 50, "mutation": .32, "crossover": .8}
METRICS = ["score", "travel_km", "served", "on_time_rate", "runtime_ms", "violations", "overtime_min"]


def ga_seed(scenario_index, trial):
    return 50000 + scenario_index * 7 + trial


class ExperimentRunner:
    def __init__(self, n_scenarios=20, trials=2, first_seed=1000, ga_params=None):
        self.n_scenarios = n_scenarios
        self.trials = trials
        self.first_seed = first_seed
        self.ga_params = dict(GA_DEFAULTS, **(ga_params or {}))
        self.rows = []
        self.curves = []
        self.sample = None
        self.elapsed = 0.0

    def _row(self, sid, seed, plan, opt_seed, scenario):
        row = {
            "scenario": sid + 1,
            "scenario_seed": seed,
            "algorithm": plan.method,
            "optimizer_seed": opt_seed,
            "jobs": len(scenario.jobs),
            "technicians": len(scenario.techs),
            "astar_expanded": scenario.router.nodes_expanded,
            "runtime_ms": round(plan.runtime_ms, 4),
        }
        for k, v in plan.result.items():
            if k in ("unserved", "routes", "schedule"):
                continue
            row[k] = round(v, 3) if isinstance(v, float) else v
        return row

    def run_all(self, progress=None):
        t0 = time.perf_counter()
        self.rows, self.curves = [], []
        for sid in range(self.n_scenarios):
            seed = self.first_seed + sid
            scenario = generate_scenario(seed)
            ev = scenario.evaluator()
            base = NearestEligibleDispatcher().optimize(ev)
            self.rows.append(self._row(sid, seed, base, "-", scenario))
            for trial in range(self.trials):
                s = ga_seed(sid, trial)
                ga = GeneticOptimizer(seed=s, **self.ga_params).optimize(ev, base)
                self.rows.append(self._row(sid, seed, ga, s, scenario))
                if trial == 0:
                    self.curves.append(ga.trace)
                    if sid == 0:
                        self.sample = (scenario, base, ga)
            if progress:
                progress(sid + 1, self.n_scenarios)
        self.elapsed = time.perf_counter() - t0
        return self.rows, self.curves

    def by_method(self, method):
        return [r for r in self.rows if r["algorithm"] == method]

    def summary(self):
        base = self.by_method("nearest-eligible")
        ga = self.by_method("genetic-optimizer")
        mean = lambda rows, k: round(statistics.mean(r[k] for r in rows), 3)
        b = {k: mean(base, k) for k in METRICS}
        g = {k: mean(ga, k) for k in METRICS}
        base_score = {r["scenario"]: r["score"] for r in base}
        improved = sum(1 for r in ga if r["score"] < base_score[r["scenario"]] - 1e-9)
        equal = sum(1 for r in ga if abs(r["score"] - base_score[r["scenario"]]) <= 1e-9)
        return {
            "n_scenarios": len(base),
            "n_ga_trials": len(ga),
            "baseline": b,
            "ga": g,
            "objective_improvement_pct": round(100 * (b["score"] - g["score"]) / b["score"], 2),
            "travel_reduction_pct": round(100 * (b["travel_km"] - g["travel_km"]) / b["travel_km"], 2),
            "ga_improved_objective_trials": improved,
            "ga_equal_objective_trials": equal,
            "ga_worse_objective_trials": len(ga) - improved - equal,
        }

    def run_info(self):
        return {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "created": datetime.now().isoformat(timespec="seconds"),
            "total_seconds": round(self.elapsed, 2),
            "scenario_seeds": list(range(self.first_seed, self.first_seed + self.n_scenarios)),
            "optimization_seeds": "50000 + scenario_index*7 + trial_index",
            "trials_per_scenario": self.trials,
            "graph": "8x8 undirected generated grid, edge weights in {1, 1.15, 1.3, 1.5}",
            "baseline": "earliest-window-end job first; nearest feasible technician",
            "ga": dict(self.ga_params, elitism=3, tournament_size=3),
            "objective": f"travel_units + {UNSERVED_PENALTY} * weighted_unserved + {WAIT_WEIGHT} * waiting_min",
            "distance_km": f"A* path cost x {KM_PER_UNIT}",
            "travel_time": f"60 * km / {SPEED_KMH} km/h",
        }

    def export_csv(self, out=RESULTS_DIR):
        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        with open(out / "results.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(self.rows[0]))
            w.writeheader()
            w.writerows(self.rows)
        with open(out / "convergence.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["scenario", "generation", "best_score"])
            for sid, trace in enumerate(self.curves, 1):
                for gen, score in enumerate(trace):
                    w.writerow([sid, gen, round(score, 4)])
        (out / "summary.json").write_text(json.dumps(self.summary(), indent=2))
        (out / "run_info.json").write_text(json.dumps(self.run_info(), indent=2))
        if self.sample:
            scenario, base, ga = self.sample
            data = scenario.to_dict()
            data["baseline_routes"] = base.result["routes"]
            data["ga_routes"] = ga.result["routes"]
            (out / "sample_scenario.json").write_text(json.dumps(data, indent=2))
        return out

    def console_report(self):
        lines = []
        for method in ("nearest-eligible", "genetic-optimizer"):
            rows = self.by_method(method)
            lines.append(
                f"{method:<18} N={len(rows):<3} mean travel={statistics.mean(r['travel_km'] for r in rows):.2f} km  "
                f"served={statistics.mean(r['served'] for r in rows):.2f}  cost={statistics.mean(r['score'] for r in rows):.2f}  "
                f"runtime={statistics.mean(r['runtime_ms'] for r in rows):.2f} ms"
            )
        s = self.summary()
        lines.append(f"objective improvement {s['objective_improvement_pct']}%  |  travel reduction {s['travel_reduction_pct']}%  |  "
                     f"GA better in {s['ga_improved_objective_trials']}/{s['n_ga_trials']}, tied {s['ga_equal_objective_trials']}")
        return "\n".join(lines)


def load_results(folder=RESULTS_DIR):
    folder = Path(folder)
    if not (folder / "results.csv").is_file():
        raise FileNotFoundError(f"No saved experiment in {folder}. Run: python -m src.main experiment")
    rows = []
    with open(folder / "results.csv", newline="") as f:
        for r in csv.DictReader(f):
            for k, v in r.items():
                try:
                    r[k] = int(v)
                except ValueError:
                    try:
                        r[k] = float(v)
                    except ValueError:
                        pass
            rows.append(r)
    curves = {}
    with open(folder / "convergence.csv", newline="") as f:
        for r in csv.DictReader(f):
            curves.setdefault(int(r["scenario"]), []).append(float(r["best_score"]))
    summary = json.loads((folder / "summary.json").read_text())
    info = json.loads((folder / "run_info.json").read_text()) if (folder / "run_info.json").is_file() else {}
    return {"rows": rows, "curves": [curves[k] for k in sorted(curves)], "summary": summary, "info": info}
