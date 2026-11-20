from dataclasses import dataclass, asdict

SKILLS = ("electrical", "plumbing", "hvac")
SHIFT_START = 480
SHIFT_END = 1020


def clock(minutes):
    minutes = int(round(minutes))
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


@dataclass(frozen=True)
class Job:
    id: int
    node: int
    skill: str
    duration: int
    start: int
    end: int
    priority: int = 1

    def __post_init__(self):
        self.validate()

    def validate(self, n_nodes=None):
        if not isinstance(self.skill, str) or not self.skill.strip():
            raise ValueError(f"Job {self.id}: required skill is missing")
        if not isinstance(self.duration, (int, float)) or self.duration <= 0:
            raise ValueError(f"Job {self.id}: duration must be a positive number of minutes (got {self.duration})")
        if self.start < 0 or self.end > 24 * 60:
            raise ValueError(f"Job {self.id}: appointment window must lie inside one day (00:00-24:00)")
        if self.start >= self.end:
            raise ValueError(f"Job {self.id}: window start {clock(self.start)} is not before window end {clock(self.end)}")
        if self.priority < 1:
            raise ValueError(f"Job {self.id}: priority must be 1 or higher (got {self.priority})")
        if not isinstance(self.node, int) or self.node < 0 or (n_nodes is not None and self.node >= n_nodes):
            raise ValueError(f"Job {self.id}: location node {self.node} is outside the road graph")
        return True

    def is_within_window(self, finish_time):
        return self.start <= finish_time <= self.end

    @property
    def penalty_weight(self):
        return 1 + .25 * (self.priority - 1)

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class Technician:
    id: int
    start_node: int
    skills: tuple
    shift_start: int = SHIFT_START
    shift_end: int = SHIFT_END

    def __post_init__(self):
        self.validate()

    def validate(self, n_nodes=None):
        if not self.skills:
            raise ValueError(f"Technician {self.id}: needs at least one skill")
        if self.shift_start >= self.shift_end:
            raise ValueError(f"Technician {self.id}: shift start must be before shift end")
        if not isinstance(self.start_node, int) or self.start_node < 0 or (n_nodes is not None and self.start_node >= n_nodes):
            raise ValueError(f"Technician {self.id}: start node {self.start_node} is outside the road graph")
        return True

    def can_perform(self, job):
        return job.skill in self.skills

    def available_at(self, minute):
        return self.shift_start <= minute <= self.shift_end

    def to_dict(self):
        d = asdict(self)
        d["skills"] = list(self.skills)
        return d


@dataclass
class Stop:
    job_id: int
    tech: int
    depart: float
    arrival: float
    begin: float
    finish: float
    travel: float

    @property
    def waiting(self):
        return max(0.0, self.begin - self.arrival)


class Schedule:
    def __init__(self, n_techs):
        self.routes = [[] for _ in range(n_techs)]
        self.assignment = {}
        self.stops = {}
        self.unserved = []

    def assign_job(self, stop):
        if stop.job_id in self.assignment:
            raise ValueError(f"Job {stop.job_id} is already assigned to technician {self.assignment[stop.job_id]}")
        self.assignment[stop.job_id] = stop.tech
        self.stops[stop.job_id] = stop
        self.routes[stop.tech].append(stop.job_id)

    def route_for(self, tech_index):
        return [self.stops[j] for j in self.routes[tech_index]]

    @property
    def served(self):
        return len(self.assignment)

    def validate(self, techs, jobs):
        problems = []
        seen = set()
        for t, route in enumerate(self.routes):
            tech = techs[t]
            last_finish = tech.shift_start
            for jid in route:
                job, stop = jobs[jid], self.stops[jid]
                if jid in seen:
                    problems.append(f"job {jid} appears in more than one route")
                seen.add(jid)
                if not tech.can_perform(job):
                    problems.append(f"technician {t} lacks {job.skill} for job {jid}")
                if not job.is_within_window(stop.finish):
                    problems.append(f"job {jid} finishes outside its window")
                if not tech.available_at(stop.finish):
                    problems.append(f"job {jid} finishes after technician {t}'s shift")
                if stop.begin + 1e-9 < last_finish:
                    problems.append(f"job {jid} overlaps the previous visit of technician {t}")
                last_finish = stop.finish
        return problems
