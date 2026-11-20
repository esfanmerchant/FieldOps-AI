import mimetypes
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from .agents import NearestEligibleDispatcher, GeneticOptimizer
from .environment import (
    Scenario, ScenarioValidationError, NoFeasibleScheduleError, generate_scenario,
    KM_PER_UNIT, SPEED_KMH, MIN_PER_UNIT, UNSERVED_PENALTY, WAIT_WEIGHT,
)
from .experiments import ExperimentRunner, GA_DEFAULTS, RESULTS_DIR, load_results
from .models import SKILLS, SHIFT_START, SHIFT_END
from .search import GRID, build_road_graph, edge_list, compare_searches
from . import figures

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = ROOT / "data"

REPORT = {
    "baseline_cost": 68.74, "ga_cost": 54.69,
    "baseline_km": 35.87, "ga_km": 33.71,
    "baseline_served": 12.95, "ga_served": 13.15,
    "improvement_pct": 20.44, "travel_reduction_pct": 6.0,
    "improved": 37, "tied": 3,
}


def clamp(value, lo, hi, default):
    try:
        return max(lo, min(hi, type(default)(value)))
    except (TypeError, ValueError):
        return default


def roads_for(scenario):
    closed = {frozenset(e) for e in scenario.closed_roads}
    full = build_road_graph(scenario.road_seed, scenario.size)
    return [[u, v, w, frozenset((u, v)) in closed] for u, v, w in edge_list(full)]


def scenario_payload(scenario):
    return {"scenario": scenario.to_dict(), "roads": roads_for(scenario)}


def plan_payload(scenario, ev, plan):
    res = plan.result
    sched = res["schedule"]
    techs = []
    for t, tech in enumerate(scenario.techs):
        legs, here = [], tech.start_node
        for stop in sched.route_for(t):
            job = scenario.jobs[stop.job_id]
            legs.append({
                "job": stop.job_id,
                "path": scenario.paths[(here, job.node)],
                "units": round(stop.travel, 3),
                "km": round(stop.travel * KM_PER_UNIT, 2),
                "depart": round(stop.depart, 1),
                "arrival": round(stop.arrival, 1),
                "begin": round(stop.begin, 1),
                "finish": round(stop.finish, 1),
                "wait": round(stop.waiting, 1),
            })
            here = job.node
        service = sum(scenario.jobs[l["job"]].duration for l in legs)
        techs.append({
            "id": t,
            "route": res["routes"][t],
            "legs": legs,
            "km": round(sum(l["km"] for l in legs), 2),
            "service_min": service,
            "wait_min": round(sum(l["wait"] for l in legs), 1),
            "end": legs[-1]["finish"] if legs else tech.shift_start,
        })
    unserved = []
    for j in res["unserved"]:
        code, reason = ev.check.explain(scenario.jobs[j])
        unserved.append({"job": j, "code": code, "reason": reason})
    penalty = sum(scenario.jobs[j].penalty_weight for j in res["unserved"])
    return {
        "method": plan.method,
        "score": round(res["score"], 3),
        "travel_km": round(res["travel_km"], 2),
        "travel_units": round(res["travel_units"], 3),
        "served": res["served"],
        "total": len(scenario.jobs),
        "waiting_min": round(res["waiting_min"], 1),
        "on_time_rate": res["on_time_rate"],
        "overtime_min": res["overtime_min"],
        "violations": res["violations"],
        "runtime_ms": round(plan.runtime_ms, 2),
        "breakdown": {
            "travel": round(res["travel_units"], 3),
            "unserved": round(UNSERVED_PENALTY * penalty, 3),
            "waiting": round(WAIT_WEIGHT * res["waiting_min"], 3),
        },
        "techs": techs,
        "unserved": unserved,
        "order": plan.order,
        "genes": plan.genes,
    }


def create_app():
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("image/svg+xml", ".svg")
    mimetypes.add_type("font/woff2", ".woff2")
    app = Flask(__name__, static_folder=str(WEB), static_url_path="")
    app.json.sort_keys = False

    @app.errorhandler(ScenarioValidationError)
    def bad_scenario(e):
        return jsonify(error="The scenario has invalid records", details=e.errors), 400

    @app.errorhandler(FileNotFoundError)
    def missing(e):
        return jsonify(error=str(e)), 404

    @app.errorhandler(ValueError)
    def bad_value(e):
        return jsonify(error=str(e)), 400

    @app.get("/")
    def index():
        return send_from_directory(WEB, "index.html")

    @app.get("/api/meta")
    def meta():
        return jsonify(
            grid=GRID, skills=SKILLS, shift=[SHIFT_START, SHIFT_END],
            km_per_unit=KM_PER_UNIT, speed_kmh=SPEED_KMH, min_per_unit=MIN_PER_UNIT,
            unserved_penalty=UNSERVED_PENALTY, wait_weight=WAIT_WEIGHT,
            ga_defaults=GA_DEFAULTS, report=REPORT, report_seeds=list(range(1000, 1020)),
        )

    @app.post("/api/scenario")
    def new_scenario():
        body = request.get_json(silent=True) or {}
        seed = clamp(body.get("seed", 1000), 0, 10**9, 1000)
        nt = body.get("n_techs")
        nj = body.get("n_jobs")
        scenario = generate_scenario(
            seed,
            clamp(nt, 1, 8, 4) if nt else None,
            clamp(nj, 1, 40, 12) if nj else None,
            body.get("windows", "normal"),
        )
        return jsonify(scenario_payload(scenario))

    @app.post("/api/validate")
    def validate():
        try:
            scenario = Scenario.from_dict(request.get_json(silent=True))
        except ScenarioValidationError as e:
            return jsonify(ok=False, error="The scenario has invalid records", details=e.errors)
        return jsonify(ok=True, **scenario_payload(scenario))

    @app.post("/api/solve")
    def solve():
        body = request.get_json(silent=True) or {}
        scenario = Scenario.from_dict(body.get("scenario"))
        cfg = body.get("ga") or {}
        ga = GeneticOptimizer(
            population=clamp(cfg.get("population"), 4, 200, 36),
            generations=clamp(cfg.get("generations"), 1, 400, 50),
            mutation=clamp(cfg.get("mutation"), 0.0, 1.0, .32),
            crossover=clamp(cfg.get("crossover"), 0.0, 1.0, .8),
            seed=clamp(cfg.get("seed"), 0, 10**9, 50000),
        )
        ev = scenario.evaluator()
        base = NearestEligibleDispatcher().optimize(ev)
        best = ga.optimize(ev, base)

        warning = None
        try:
            ev.require_feasible(best.result)
        except NoFeasibleScheduleError as e:
            warning = {"message": str(e), "reasons": e.reasons}

        snapshots = [{"gen": g, "score": round(s, 3), "routes": ev.evaluate(o, gn)["routes"], "order": o, "genes": gn}
                     for g, s, o, gn in best.snapshots]
        return jsonify(
            **scenario_payload(scenario),
            baseline=plan_payload(scenario, ev, base),
            ga=plan_payload(scenario, ev, best),
            history=[{k: round(v, 3) if isinstance(v, float) else v for k, v in h.items()} for h in best.history],
            snapshots=snapshots,
            ga_config={"population": ga.population, "generations": ga.generations, "mutation": ga.mutation_rate,
                       "crossover": ga.crossover_rate, "elite": ga.elite, "tournament": ga.tournament, "seed": ga.seed},
            astar={"calls": scenario.router.calls, "nodes_expanded": scenario.router.nodes_expanded,
                   "locations": len(scenario.locations())},
            evaluations=ev.calls,
            paths={f"{s}-{d}": p for (s, d), p in scenario.paths.items()},
            warning=warning,
        )

    @app.post("/api/search")
    def search():
        body = request.get_json(silent=True) or {}
        size = clamp(body.get("grid"), 3, 16, GRID)
        seed = clamp(body.get("road_seed"), 0, 10**9, 1000)
        closed = [tuple(e) for e in body.get("closed_roads", []) if isinstance(e, list) and len(e) == 2]
        start = clamp(body.get("start"), 0, size * size - 1, 0)
        goal = clamp(body.get("goal"), 0, size * size - 1, size * size - 1)
        graph = build_road_graph(seed, size, closed)
        return jsonify(start=start, goal=goal, results=compare_searches(graph, start, goal, size))

    @app.get("/api/experiments")
    def experiments():
        return jsonify(load_results(RESULTS_DIR))

    @app.post("/api/experiments/run")
    def run_experiments():
        runner = ExperimentRunner()
        runner.run_all()
        runner.export_csv(RESULTS_DIR)
        figures.make_all(runner, RESULTS_DIR)
        return jsonify(load_results(RESULTS_DIR))

    @app.get("/samples/<path:name>")
    def sample_file(name):
        return send_from_directory(DATA, name)

    @app.get("/results/<path:name>")
    def result_file(name):
        return send_from_directory(RESULTS_DIR, name)

    return app
