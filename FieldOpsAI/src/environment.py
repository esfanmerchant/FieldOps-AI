import json
import math
import random
from pathlib import Path

from .models import SKILLS, SHIFT_START, SHIFT_END, Job, Technician, Schedule, Stop
from .search import GRID, INF, build_road_graph, build_cost_matrix

KM_PER_UNIT = 0.8
SPEED_KMH = 30
MIN_PER_UNIT = 60 * KM_PER_UNIT / SPEED_KMH
UNSERVED_PENALTY = 42
WAIT_WEIGHT = 0.025

WINDOW_STARTS = [490, 520, 550, 580, 610, 650, 690, 730, 770, 810, 850]
WINDOW_WIDTHS = {
    "normal": [110, 140, 170, 190, 210],
    "tight": [70, 85, 100, 115, 130],
    "relaxed": [200, 240, 280, 320, 360],
}
DURATIONS = [25, 30, 40, 50, 60]


class NoFeasibleScheduleError(Exception):
    def __init__(self, message, reasons=None):
        super().__init__(message)
        self.reasons = reasons or []


class ScenarioValidationError(ValueError):
    def __init__(self, errors):
        super().__init__("; ".join(errors))
        self.errors = errors


class Scenario:
    def __init__(self, techs, jobs, road_seed, size=GRID, closed_roads=(), name=""):
        self.techs = list(techs)
        self.jobs = list(jobs)
        self.road_seed = road_seed
        self.size = size
        self.closed_roads = [tuple(e) for e in closed_roads]
        self.name = name or f"Scenario {road_seed}"
        self.graph = build_road_graph(road_seed, size, self.closed_roads)
        self.router = self.costs = self.paths = None

    @property
    def n_nodes(self):
        return self.size * self.size

    def locations(self):
        return set([t.start_node for t in self.techs] + [j.node for j in self.jobs])

    def route_costs(self):
        if self.costs is None:
            self.router, self.costs, self.paths = build_cost_matrix(self.graph, self.locations(), self.size)
        return self.costs

    def evaluator(self):
        self.route_costs()
        return ScheduleEvaluator(self.techs, self.jobs, self.costs)

    def to_dict(self):
        return {
            "name": self.name,
            "road_seed": self.road_seed,
            "grid": self.size,
            "closed_roads": [list(e) for e in self.closed_roads],
            "technicians": [t.to_dict() for t in self.techs],
            "jobs": [j.to_dict() for j in self.jobs],
        }

    @classmethod
    def from_dict(cls, data):
        errors = []
        if not isinstance(data, dict):
            raise ScenarioValidationError(["scenario must be a JSON object"])
        size = _number(data.get("grid", GRID), "grid", errors)
        if size is not None and not 3 <= size <= 16:
            errors.append("grid: must be between 3 and 16")
            size = None
        size = size or GRID
        n_nodes = size * size
        seed = _number(data.get("road_seed", 0), "road_seed", errors) or 0

        techs = []
        raw_techs = data.get("technicians")
        if not isinstance(raw_techs, list) or not raw_techs:
            errors.append("technicians: at least one technician is required")
            raw_techs = []
        for i, row in enumerate(raw_techs):
            try:
                skills = row.get("skills")
                if isinstance(skills, str):
                    skills = [skills]
                if not isinstance(skills, list):
                    raise ValueError(f"Technician {i}: 'skills' must be a list")
                tech = Technician(
                    i,
                    _field(row, "start_node", i, "Technician"),
                    tuple(str(s).strip().lower() for s in skills),
                    int(row.get("shift_start", SHIFT_START)),
                    int(row.get("shift_end", SHIFT_END)),
                )
                tech.validate(n_nodes)
                techs.append(tech)
            except (ValueError, TypeError, AttributeError) as e:
                errors.append(_clean(e, f"Technician {i}"))

        jobs = []
        raw_jobs = data.get("jobs")
        if not isinstance(raw_jobs, list) or not raw_jobs:
            errors.append("jobs: at least one job is required")
            raw_jobs = []
        for i, row in enumerate(raw_jobs):
            try:
                job = Job(
                    i,
                    _field(row, "node", i, "Job"),
                    str(row.get("skill", "")).strip().lower(),
                    _field(row, "duration", i, "Job"),
                    _field(row, "start", i, "Job"),
                    _field(row, "end", i, "Job"),
                    int(row.get("priority", 1)),
                )
                job.validate(n_nodes)
                jobs.append(job)
            except (ValueError, TypeError, AttributeError) as e:
                errors.append(_clean(e, f"Job {i}"))

        closed = []
        for e in data.get("closed_roads", []) or []:
            if isinstance(e, (list, tuple)) and len(e) == 2 and all(isinstance(v, int) and 0 <= v < n_nodes for v in e):
                closed.append((e[0], e[1]))
            else:
                errors.append(f"closed_roads: {e} is not a valid [node, node] pair")

        if errors:
            raise ScenarioValidationError(errors)
        return cls(techs, jobs, seed, size, closed, str(data.get("name", "")))


def _number(value, name, errors):
    try:
        if isinstance(value, bool):
            raise ValueError
        return int(value)
    except (TypeError, ValueError):
        errors.append(f"{name}: expected a whole number, got {value!r}")
        return None


def _field(row, key, i, kind):
    if not isinstance(row, dict):
        raise ValueError(f"{kind} {i}: record must be an object")
    if key not in row or row[key] is None or row[key] == "":
        raise ValueError(f"{kind} {i}: missing field '{key}'")
    value = row[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{kind} {i}: '{key}' must be numeric, got {row[key]!r}")
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{kind} {i}: '{key}' must be a finite number")
        if value.is_integer():
            value = int(value)
    return value


def _clean(err, prefix):
    msg = str(err)
    return msg if msg.startswith(prefix) else f"{prefix}: {msg}"


def generate_scenario(seed, n_techs=None, n_jobs=None, windows="normal", size=GRID):
    rng = random.Random(seed)
    nodes = size * size
    nt = rng.choice([3, 4, 5])
    nj = rng.choice([10, 12, 14, 16])
    nt = n_techs or nt
    nj = n_jobs or nj
    widths = WINDOW_WIDTHS.get(windows, WINDOW_WIDTHS["normal"])

    techs = []
    for i in range(nt):
        subset = tuple(s for s in SKILLS if rng.random() < .7)
        if not subset:
            subset = (rng.choice(SKILLS),)
        techs.append(Technician(i, rng.randrange(nodes), subset))

    jobs = []
    for j in range(nj):
        skill = rng.choice(SKILLS)
        start = rng.choice(WINDOW_STARTS)
        width = rng.choice(widths)
        node = rng.randrange(nodes)
        duration = rng.choice(DURATIONS)
        priority = rng.choice([1, 1, 1, 2])
        jobs.append(Job(j, node, skill, duration, start, min(SHIFT_END, start + width), priority))

    return Scenario(techs, jobs, seed, size, name=f"Seed {seed}")


def load_scenario(path):
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Scenario file not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"{path.name} is not valid JSON (line {e.lineno}, column {e.colno})")
    return Scenario.from_dict(data)


def save_scenario(scenario, path):
    Path(path).write_text(json.dumps(scenario.to_dict(), indent=2), encoding="utf-8")


class ConstraintChecker:
    def __init__(self, techs, jobs, costs):
        self.techs = techs
        self.jobs = jobs
        self.costs = costs

    def try_append(self, tech, loc, clock, job):
        if not tech.can_perform(job):
            return None
        dist = self.costs.get((loc, job.node), INF)
        if not math.isfinite(dist):
            return None
        arrival = clock + dist * MIN_PER_UNIT
        begins = max(arrival, job.start)
        finish = begins + job.duration
        if finish > job.end or finish > tech.shift_end:
            return None
        return (job.node, finish, dist, arrival, begins)

    def validate(self, schedule):
        return schedule.validate(self.techs, self.jobs)

    def explain(self, job):
        capable = [t for t in self.techs if t.can_perform(job)]
        if not capable:
            return "skill", f"No technician is qualified for '{job.skill}' work"
        reachable = [t for t in capable if math.isfinite(self.costs.get((t.start_node, job.node), INF))]
        if not reachable:
            return "road", "No open road connects a qualified technician to this location"
        if job.end - job.start < job.duration:
            return "window", "Appointment window is shorter than the service time"
        if not any(self.try_append(t, t.start_node, t.shift_start, job) for t in reachable):
            return "reach", "Window closes before any qualified technician can arrive and finish"
        ids = ", ".join(f"T{t.id}" for t in reachable)
        return "busy", f"Qualified technicians ({ids}) were committed to other visits during this window"


class ScheduleEvaluator:
    def __init__(self, techs, jobs, costs):
        self.techs = techs
        self.jobs = jobs
        self.check = ConstraintChecker(techs, jobs, costs)
        self.calls = 0

    def _simulate(self, order, genes, schedule=None):
        self.calls += 1
        states = [(t.start_node, t.shift_start) for t in self.techs]
        visited = set()
        dist = 0.0
        waiting = 0.0
        for jid in order:
            if jid in visited:
                continue
            job = self.jobs[jid]
            ti = genes[jid]
            loc, now = states[ti]
            step = self.check.try_append(self.techs[ti], loc, now, job)
            if step is None:
                continue
            node, finish, d, arrival, begin = step
            dist += d
            waiting += max(0, begin - arrival)
            states[ti] = (node, finish)
            visited.add(jid)
            if schedule is not None:
                schedule.assign_job(Stop(jid, ti, now, arrival, begin, finish, d))
        unserved = sorted(set(range(len(self.jobs))) - visited)
        penalty = sum(self.jobs[j].penalty_weight for j in unserved)
        score = dist + UNSERVED_PENALTY * penalty + WAIT_WEIGHT * waiting
        return score, dist, waiting, unserved, states

    def score(self, order, genes):
        return self._simulate(order, genes)[0]

    def evaluate(self, order, genes):
        schedule = Schedule(len(self.techs))
        score, dist, waiting, unserved, states = self._simulate(order, genes, schedule)
        schedule.unserved = unserved
        served = schedule.served
        on_time = sum(1 for jid, s in schedule.stops.items() if self.jobs[jid].is_within_window(s.finish))
        overtime = sum(max(0, finish - t.shift_end) for (_, finish), t in zip(states, self.techs))
        return {
            "score": score,
            "travel_km": dist * KM_PER_UNIT,
            "served": served,
            "on_time_rate": on_time / served if served else 0.0,
            "overtime_min": overtime,
            "violations": len(self.check.validate(schedule)),
            "unserved": unserved,
            "routes": schedule.routes,
            "waiting_min": waiting,
            "travel_units": dist,
            "schedule": schedule,
        }

    def require_feasible(self, result):
        if self.jobs and result["served"] == 0:
            reasons = [f"Job {j}: {self.check.explain(self.jobs[j])[1]}" for j in result["unserved"]]
            raise NoFeasibleScheduleError("No feasible schedule: not a single job can be served", reasons)
        return result
