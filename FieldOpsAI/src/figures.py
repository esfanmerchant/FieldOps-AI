from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

NAVY = "#203a63"
TEAL = "#17838a"
TECH_COLORS = ["#2a7f9e", "#c97a32", "#5b7f43", "#8c3f6b", "#6a5acd", "#b5523b"]

plt.rcParams.update({
    "font.size": 11,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.titleweight": "bold",
    "axes.titlecolor": NAVY,
    "axes.labelcolor": NAVY,
})


def comparison_chart(summary, out):
    fig, ax = plt.subplots(figsize=(10, 3.8))
    labels = ["Nearest-eligible baseline", "Genetic optimizer"]
    vals = [summary["baseline"]["score"], summary["ga"]["score"]]
    bars = ax.barh(labels[::-1], vals[::-1], color=[TEAL, NAVY], height=.55)
    for b, v in zip(bars, vals[::-1]):
        ax.text(v + 1, b.get_y() + b.get_height() / 2, f"{v:.1f}", va="center", fontweight="bold", color=NAVY, fontsize=14)
    ax.set_xlim(0, max(vals) * 1.25)
    ax.set_xlabel("Mean weighted objective (lower is better)")
    ax.set_title(f"Objective cost, {summary['n_scenarios']} matched synthetic scenarios")
    ax.grid(axis="x", alpha=.25)
    fig.tight_layout()
    fig.savefig(out, dpi=160)
    plt.close(fig)


def convergence_chart(curves, out):
    gens = len(curves[0])
    mean = [sum(c[g] for c in curves) / len(curves) for g in range(gens)]
    fig, ax = plt.subplots(figsize=(10, 3.6))
    ax.plot(range(gens), mean, color=TEAL, lw=3)
    ax.scatter([0, gens - 1], [mean[0], mean[-1]], color=NAVY, zorder=3, s=60)
    ax.annotate(f"{mean[0]:.1f}", (0, mean[0]), xytext=(8, 10), textcoords="offset points", color=NAVY)
    ax.annotate(f"{mean[-1]:.1f}", (gens - 1, mean[-1]), xytext=(-24, 12), textcoords="offset points", color=NAVY)
    ax.set_xlabel("Generation")
    ax.set_ylabel("Mean best-so-far cost")
    ax.set_title(f"Genetic-algorithm convergence ({len(curves)} scenarios, seed 1)")
    ax.grid(alpha=.25)
    fig.tight_layout()
    fig.savefig(out, dpi=160)
    plt.close(fig)


def improvement_heatmap(rows, out):
    base = {r["scenario"]: r["score"] for r in rows if r["algorithm"] == "nearest-eligible"}
    trials = {}
    for r in rows:
        if r["algorithm"] == "genetic-optimizer":
            trials.setdefault(r["scenario"], []).append(100 * (base[r["scenario"]] - r["score"]) / base[r["scenario"]])
    ids = sorted(trials)
    grid = [[trials[s][k] for s in ids] for k in range(len(trials[ids[0]]))]
    fig, ax = plt.subplots(figsize=(11, 3))
    im = ax.imshow(grid, cmap="BrBG", vmin=-65, vmax=65, aspect="auto")
    for k, row in enumerate(grid):
        for i, v in enumerate(row):
            ax.text(i, k, f"{v:.1f}", ha="center", va="center", fontsize=8, color="white" if v > 45 else "black")
    ax.set_xticks(range(len(ids)), ids)
    ax.set_yticks(range(len(grid)), [f"GA seed {chr(65 + k)}" for k in range(len(grid))])
    ax.set_xlabel("Scenario ID")
    ax.set_title("GA improvement over baseline by scenario and random seed (%)")
    fig.colorbar(im, ax=ax, label="Objective reduction (%)", pad=.02)
    fig.tight_layout()
    fig.savefig(out, dpi=160)
    plt.close(fig)


def route_map(scenario, plans, out):
    size = scenario.size
    pos = lambda n: (n % size, -(n // size))
    fig, axes = plt.subplots(1, len(plans), figsize=(7 * len(plans), 6.4))
    for ax, (title, plan) in zip(axes, plans):
        for u, nbrs in scenario.graph.items():
            for v, _ in nbrs:
                if u < v:
                    (x1, y1), (x2, y2) = pos(u), pos(v)
                    ax.plot([x1, x2], [y1, y2], color="#d6dee8", lw=1, zorder=1)
        for t, route in enumerate(plan.result["routes"]):
            color = TECH_COLORS[t % len(TECH_COLORS)]
            here = scenario.techs[t].start_node
            for jid in route:
                path = scenario.paths[(here, scenario.jobs[jid].node)]
                xs, ys = zip(*[pos(n) for n in path])
                ax.plot(xs, ys, color=color, lw=3, zorder=2)
                here = scenario.jobs[jid].node
        for j in scenario.jobs:
            x, y = pos(j.node)
            ax.scatter(x, y, s=140, color="#f5c66b", edgecolor="#6b4f1d", zorder=3)
            ax.text(x + .12, y + .1, f"J{j.id}", fontsize=8, color="#5a4a2a")
        for t in scenario.techs:
            x, y = pos(t.start_node)
            c = TECH_COLORS[t.id % len(TECH_COLORS)]
            ax.scatter(x, y, s=220, marker="s", color=c, zorder=4)
            ax.text(x, y + .22, f"T{t.id}", color=c, ha="center", fontweight="bold")
        ax.set_title(title, fontsize=15)
        ax.set_aspect("equal")
        ax.axis("off")
    fig.suptitle(f"Example offline route plan ({scenario.name}, {size} x {size} synthetic grid)", color=NAVY, fontweight="bold", fontsize=15)
    fig.text(.5, .03, "Colored squares = technician start locations  |  Gold circles = service jobs  |  Colored lines = assigned shortest paths",
             ha="center", color="#5a6b80")
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)


def make_all(runner, out):
    out = Path(out) / "figures"
    out.mkdir(parents=True, exist_ok=True)
    summary = runner.summary()
    comparison_chart(summary, out / "comparison.png")
    convergence_chart(runner.curves, out / "convergence.png")
    improvement_heatmap(runner.rows, out / "improvement_heatmap.png")
    if runner.sample:
        scenario, base, ga = runner.sample
        route_map(scenario, [("Nearest eligible", base), ("Genetic optimizer", ga)], out / "route_map.png")
    return out
