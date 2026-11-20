# FieldOps AI

Intelligent technician dispatch and route optimization. AL-2002 Artificial Intelligence Lab project, FAST NUCES Karachi, Fall 2026.

| Member | Roll no. | Part |
|---|---|---|
| Ahmed Raza (leader) | 24K-2515 | `models.py`, `environment.py`, `main.py`, `server.py` |
| Amaan Jilani | 24K-2540 | `search.py` (road graph, A*, search comparison) |
| Esfan Merchant | 24K-2546 | `agents.py`, `experiments.py`, `figures.py`, `web/` dashboard |

## What it does

A service company has technicians with different skills (electrical, plumbing, HVAC), fixed shifts and start depots. Customers book jobs with an appointment window. FieldOps AI decides which technician does which job and in what order.

1. A synthetic city is generated as an 8 x 8 weighted road grid.
2. **A\*** finds the shortest road path between every pair of important locations.
3. A **constraint checker** accepts a visit only if the technician has the skill, a road exists, and the job finishes inside the appointment window and the shift.
4. The **nearest-eligible baseline** handles jobs by earliest deadline and gives each to the closest feasible technician.
5. A **genetic algorithm** evolves visit orders and technician assignments, starting from the baseline.
6. Both plans are scored by the same **schedule evaluator**:
   `cost = travel_units + 42 x weighted_unserved_jobs + 0.025 x waiting_minutes`

## Setup

Python 3.11 or newer.

```bash
pip install -r requirements.txt
```

## Running

On Windows you can double-click `run.bat`. Otherwise:

```bash
python -m src.main serve          # web dashboard on http://127.0.0.1:5000
python -m src.main experiment     # 20-scenario benchmark -> results/
python -m src.main solve --seed 1000
python -m src.main solve --file data/sample_scenario.json
python -m src.main test           # unit tests
```

The dashboard works offline. Fonts and icons are bundled and no CDN is used.

## Dashboard pages

- **Overview**: live simulation, headline results, pipeline, PEAS.
- **Dispatch Studio**: generate a day, compare baseline vs GA, play the day, close roads, add jobs, see why a job was left unassigned.
- **Evolution Lab**: change GA parameters and watch convergence, the best chromosome and the best routes change per generation.
- **Search Lab**: A*, UCS, greedy best-first and BFS on the same graph, with nodes expanded and optimality.
- **Experiments**: the benchmark used in the report, charts, heatmap and all 60 runs.
- **Scenario Data**: import and validate JSON scenarios, inspect technicians and jobs.

## Results (20 scenarios, seeds 1000-1019, 2 GA seeds each)

| Method | Mean travel (km) | Mean jobs served | Mean cost |
|---|---|---|---|
| Nearest-eligible + A* | 35.87 | 12.95 | 68.74 |
| Genetic optimizer + A* | 33.71 | 13.15 | 54.69 |

The GA lowers the mean objective by 20.44% and travel by 6.0%. It was better in 37 of 40 runs and tied in 3. There were zero hard-constraint violations. Runtime depends on the machine.

## Project layout

```
src/
  models.py        Job, Technician, Stop, Schedule
  environment.py   scenario generator/loader, ConstraintChecker, ScheduleEvaluator
  search.py        road graph, AStarRouter, UCS, greedy, BFS, cost matrix
  agents.py        Planner interface, NearestEligibleDispatcher, GeneticOptimizer
  experiments.py   ExperimentRunner, CSV/JSON export
  figures.py       matplotlib charts for the report
  server.py        Flask JSON API used by the dashboard
  main.py          command line entry point
web/               dashboard (HTML, CSS, JavaScript)
data/              sample and broken scenario files
results/           benchmark output and figures
tests/             unit tests
```

## Data

All jobs and technicians are synthetic and generated with fixed random seeds. No personal or real customer data is used. The road network is a generated grid. OpenStreetMap was planned as an optional source but is not used in this version.
