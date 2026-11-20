# FieldOps AI — report reference experiment

This self-contained Python reference experiment was created to support the report visuals and comparisons. It is NOT a copy of the students' project repository and cannot verify their implementation or individual contributions.

## Requirements
Python 3.11 or later. The core experiment and smoke tests use only the Python standard library.

## Reproduce
From this extracted folder:

```bash
python reference_experiment.py --out demo_results
python test_reference.py
```

This generates 20 deterministic synthetic scenarios, one nearest-eligible baseline run per scenario, and two genetic-algorithm trials per scenario. Shared A* pairwise shortest-path costs are computed on a generated 8 x 8 road grid. Runtime figures depend on hardware and Python version and exclude A* preprocessing common to both approaches.

## Contents
- `reference_experiment.py`: scenario generator, A*, feasibility checker, baseline, GA and result writer.
- `test_reference.py`: six smoke tests; negative-duration validation remains a known gap.
- `demo_results/results.csv`: per-scenario per-method measurements.
- `demo_results/convergence.csv`: best-so-far objective traces.
- `demo_results/report_run.json`: seeds, configuration, runtime metadata.
- `demo_results/summary.json`: comparative averages.
- `demo_results/sample_scenario.json`: example graph and routes.
- `figures/`: generated figures embedded in the report.

## Report provenance
The project title, team details, scope and proposed modules are based on the provided FieldOps AI proposal, dated 22 October 2026. The Word document design was adapted from the provided AL-2002 report template. All numerical findings in the final report are from this independently executed synthetic reference experiment, not from student-submitted source code. Review and verify all claims before submission.
