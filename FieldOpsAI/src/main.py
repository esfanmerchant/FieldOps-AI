import argparse
import sys
import threading
import unittest
import webbrowser
from pathlib import Path

from .agents import NearestEligibleDispatcher, GeneticOptimizer
from .environment import ScenarioValidationError, NoFeasibleScheduleError, generate_scenario, load_scenario
from .experiments import ExperimentRunner, RESULTS_DIR
from .models import clock

ROOT = Path(__file__).resolve().parent.parent


def serve(args):
    from .server import create_app
    url = f"http://127.0.0.1:{args.port}"
    print(f"FieldOps AI dashboard running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    create_app().run(host="127.0.0.1", port=args.port, debug=False)


def experiment(args):
    from . import figures
    runner = ExperimentRunner(n_scenarios=args.scenarios, trials=args.trials)
    print(f"Running {args.scenarios} scenarios x ({args.trials} GA seeds + baseline)...")
    runner.run_all(progress=lambda i, n: print(f"\r  scenario {i}/{n}", end="", flush=True))
    print()
    out = runner.export_csv(args.out)
    figures.make_all(runner, out)
    print(runner.console_report())
    print(f"Saved results.csv, convergence.csv, summary.json, run_info.json and figures/ to {out}")


def solve(args):
    scenario = load_scenario(args.file) if args.file else generate_scenario(args.seed)
    ev = scenario.evaluator()
    base = NearestEligibleDispatcher().optimize(ev)
    ga = GeneticOptimizer(seed=args.ga_seed).optimize(ev, base)
    print(f"{scenario.name}: {len(scenario.techs)} technicians, {len(scenario.jobs)} jobs, "
          f"A* expanded {scenario.router.nodes_expanded} nodes\n")
    for plan in (base, ga):
        r = plan.result
        print(f"[{plan.method}] cost={r['score']:.2f}  travel={r['travel_km']:.2f} km  "
              f"served={r['served']}/{len(scenario.jobs)}  waiting={r['waiting_min']:.0f} min  {plan.runtime_ms:.1f} ms")
        for t, tech in enumerate(scenario.techs):
            stops = r["schedule"].route_for(t)
            route = " -> ".join(f"J{s.job_id}@{clock(s.begin)}" for s in stops) or "(idle)"
            print(f"   T{t} {'/'.join(tech.skills):<26} {route}")
        for j in r["unserved"]:
            print(f"   unserved J{j}: {ev.check.explain(scenario.jobs[j])[1]}")
        print()
    try:
        ev.require_feasible(ga.result)
    except NoFeasibleScheduleError as e:
        print("WARNING:", e)


def run_tests(args):
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), top_level_dir=str(ROOT))
    ok = unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful()
    sys.exit(0 if ok else 1)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="fieldops", description="FieldOps AI - technician dispatch and route optimization")
    sub = parser.add_subparsers(dest="cmd")

    p = sub.add_parser("serve", help="start the web dashboard")
    p.add_argument("--port", type=int, default=5000)
    p.add_argument("--no-browser", action="store_true")
    p.set_defaults(func=serve)

    p = sub.add_parser("experiment", help="run the 20-scenario benchmark")
    p.add_argument("--out", default=str(RESULTS_DIR))
    p.add_argument("--scenarios", type=int, default=20)
    p.add_argument("--trials", type=int, default=2)
    p.set_defaults(func=experiment)

    p = sub.add_parser("solve", help="plan one scenario in the terminal")
    p.add_argument("--seed", type=int, default=1000)
    p.add_argument("--file", help="scenario JSON file")
    p.add_argument("--ga-seed", type=int, default=50000)
    p.set_defaults(func=solve)

    p = sub.add_parser("test", help="run the test suite")
    p.set_defaults(func=run_tests)

    args = parser.parse_args(argv)
    if not args.cmd:
        args = parser.parse_args(["serve"])
    try:
        args.func(args)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except ScenarioValidationError as e:
        print("Error: the scenario file has invalid records:")
        for msg in e.errors:
            print("  -", msg)
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
