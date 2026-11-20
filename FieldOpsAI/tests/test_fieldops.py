import json
import random
import tempfile
import unittest
from pathlib import Path

from src.agents import Planner, Plan, NearestEligibleDispatcher, GeneticOptimizer
from src.environment import (
    Scenario, ScenarioValidationError, NoFeasibleScheduleError, ConstraintChecker,
    generate_scenario, load_scenario,
)
from src.experiments import ExperimentRunner
from src.models import Job, Technician, Schedule, Stop
from src.search import (
    AStarRouter, build_road_graph, uniform_cost_search, breadth_first_search,
    greedy_best_first, path_cost, heuristic_is_admissible, compare_searches,
)


def solve(scenario, generations=50, seed=50000):
    ev = scenario.evaluator()
    base = NearestEligibleDispatcher().optimize(ev)
    ga = GeneticOptimizer(generations=generations, seed=seed).optimize(ev, base)
    return ev, base, ga


class ReportTestCases(unittest.TestCase):
    def test_1_normal_input(self):
        ev, base, ga = solve(generate_scenario(1000))
        for plan in (base, ga):
            self.assertGreater(plan.result["served"], 0)
            self.assertEqual(plan.result["violations"], 0)
            self.assertEqual(plan.result["overtime_min"], 0)
            self.assertEqual(plan.result["on_time_rate"], 1.0)

    def test_2_missing_file(self):
        with self.assertRaises(FileNotFoundError) as ctx:
            load_scenario("does_not_exist/scenario.json")
        self.assertIn("scenario.json", str(ctx.exception))

    def test_3_invalid_values(self):
        with self.assertRaises(ValueError):
            Job(0, 5, "plumbing", -30, 480, 600)
        data = generate_scenario(1000).to_dict()
        data["jobs"][2]["duration"] = -15
        data["jobs"][4]["node"] = 999
        data["technicians"][0]["start_node"] = "abc"
        with self.assertRaises(ScenarioValidationError) as ctx:
            Scenario.from_dict(data)
        errors = ctx.exception.errors
        self.assertEqual(len(errors), 3)
        self.assertTrue(any("Job 2" in e and "duration" in e for e in errors))
        self.assertTrue(any("Job 4" in e and "outside" in e for e in errors))

    def test_4_no_feasible_route(self):
        empty = {i: [] for i in range(64)}
        cost, path = AStarRouter(empty).find_path(0, 1)
        self.assertEqual(cost, float("inf"))
        self.assertEqual(path, [])

        tech = Technician(0, 0, ("plumbing",))
        job = Job(0, 63, "plumbing", 30, 480, 1000)
        isolated = Scenario([tech], [job], 7, closed_roads=[(55, 63), (62, 63)])
        ev = isolated.evaluator()
        plan = NearestEligibleDispatcher().optimize(ev)
        self.assertEqual(plan.result["served"], 0)
        self.assertEqual(ev.check.explain(job)[0], "road")
        with self.assertRaises(NoFeasibleScheduleError):
            ev.require_feasible(plan.result)

    def test_5_optimizer_limit(self):
        ev, base, ga = solve(generate_scenario(1000), generations=2, seed=42)
        self.assertEqual(len(ga.trace), 3)
        self.assertEqual(ga.result["violations"], 0)
        self.assertLessEqual(ga.score, base.score)

    def test_6_unavailable_skill(self):
        scenario = generate_scenario(1000)
        odd = Job(len(scenario.jobs), 10, "gas_licence", 30, 480, 1000)
        scenario = Scenario(scenario.techs, scenario.jobs + [odd], 1000)
        ev, base, ga = solve(scenario, generations=5)
        self.assertIn(odd.id, ga.result["unserved"])
        self.assertEqual(ev.check.explain(odd)[0], "skill")
        checker = ConstraintChecker(scenario.techs, scenario.jobs, scenario.costs)
        self.assertTrue(all(checker.try_append(t, t.start_node, 480, odd) is None for t in scenario.techs))


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.graph = build_road_graph(1003)

    def test_astar_matches_ucs(self):
        rng = random.Random(1)
        router = AStarRouter(self.graph)
        for _ in range(60):
            s, g = rng.randrange(64), rng.randrange(64)
            a_cost, a_path = router.find_path(s, g)
            u_cost, _, _ = uniform_cost_search(self.graph, s, g)
            self.assertAlmostEqual(a_cost, u_cost)
            self.assertAlmostEqual(path_cost(self.graph, a_path), a_cost)

    def test_heuristic_admissible(self):
        self.assertTrue(heuristic_is_admissible(self.graph))

    def test_astar_expands_less_than_ucs(self):
        runs = compare_searches(self.graph, 0, 63)
        self.assertTrue(runs["astar"]["optimal"])
        self.assertLessEqual(runs["astar"]["nodes_expanded"], runs["ucs"]["nodes_expanded"])

    def test_bfs_and_greedy_find_a_path(self):
        for fn in (breadth_first_search, greedy_best_first):
            cost, path, _ = fn(self.graph, 0, 63)
            self.assertEqual(path[0], 0)
            self.assertEqual(path[-1], 63)


class ModelAndPlannerTests(unittest.TestCase):
    def test_schedule_rejects_double_assignment(self):
        s = Schedule(2)
        s.assign_job(Stop(0, 0, 480, 490, 500, 530, 6))
        with self.assertRaises(ValueError):
            s.assign_job(Stop(0, 1, 480, 490, 500, 530, 6))

    def test_schedule_validate_flags_skill_problem(self):
        tech = Technician(0, 0, ("hvac",))
        job = Job(0, 3, "plumbing", 30, 480, 700)
        s = Schedule(1)
        s.assign_job(Stop(0, 0, 480, 490, 490, 520, 6))
        self.assertTrue(any("lacks" in p for p in s.validate([tech], [job])))

    def test_planners_share_interface(self):
        ev = generate_scenario(1001).evaluator()
        for planner in (NearestEligibleDispatcher(), GeneticOptimizer(generations=3, seed=1)):
            self.assertIsInstance(planner, Planner)
            self.assertIsInstance(planner.optimize(ev), Plan)

    def test_ga_never_worse_than_baseline(self):
        for seed in (1004, 1009, 1015):
            ev, base, ga = solve(generate_scenario(seed), generations=20)
            self.assertLessEqual(ga.score, base.score + 1e-9)

    def test_scenario_round_trip(self):
        sc = generate_scenario(1012)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.json"
            p.write_text(json.dumps(sc.to_dict()))
            again = load_scenario(p)
        self.assertEqual(again.jobs, sc.jobs)
        self.assertEqual(again.techs, sc.techs)


class ReproducibilityTest(unittest.TestCase):
    def test_report_numbers(self):
        runner = ExperimentRunner()
        runner.run_all()
        s = runner.summary()
        self.assertAlmostEqual(s["baseline"]["score"], 68.74, places=2)
        self.assertAlmostEqual(s["ga"]["score"], 54.69, places=2)
        self.assertAlmostEqual(s["baseline"]["travel_km"], 35.87, places=2)
        self.assertAlmostEqual(s["ga"]["travel_km"], 33.71, places=2)
        self.assertEqual(s["objective_improvement_pct"], 20.44)
        self.assertEqual(s["ga_improved_objective_trials"], 37)
        self.assertEqual(s["ga_equal_objective_trials"], 3)


if __name__ == "__main__":
    unittest.main()
