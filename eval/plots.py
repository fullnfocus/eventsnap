"""Report figures from results/summary.json.  Usage: python eval/plots.py  (needs matplotlib)"""
import json
import pathlib

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = pathlib.Path(__file__).resolve().parent.parent
RES = ROOT / "results"
S = json.loads((RES / "summary.json").read_text())
M = ["llm"]
NAME = {"llm": "EventSnap (OCR + LLM)"}
COLOR = {"llm": "#7b1e3a"}
FIELDS = ["title", "start_date", "start_time", "end_time", "location", "registration_link"]
FLABEL = ["Title", "Date", "Start", "End", "Location", "Link"]

plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})

# Figure 1: per-field accuracy, grouped bars
fig, ax = plt.subplots(figsize=(5.5, 2.3))
w = 0.8 / len(M)
for i, m in enumerate(M):
    vals = [100 * S["methods"][m]["field_accuracy"][f] for f in FIELDS]
    xs = [j + (i - (len(M) - 1) / 2) * w for j in range(len(FIELDS))]
    ax.bar(xs, vals, w * 0.92, label=NAME[m], color=COLOR[m])
ax.set_xticks(range(len(FIELDS)), FLABEL)
ax.set_ylabel("Accuracy (%)")
ax.set_ylim(0, 105)
ax.yaxis.grid(True, alpha=0.3)
ax.set_axisbelow(True)
fig.tight_layout()
fig.savefig(RES / "fig_field_accuracy.pdf")
fig.savefig(RES / "fig_field_accuracy.png", dpi=200)

# Figure 2: event accuracy by poster source (photo / screenshot / email ...)
sources = sorted({s for m in M for s in S["methods"][m]["by_source"]})
fig, ax = plt.subplots(figsize=(5.5, 2.1))
w = 0.8 / len(M)
for i, m in enumerate(M):
    bs = S["methods"][m]["by_source"]
    vals = [100 * bs.get(s, {}).get("critical_accuracy", 0) for s in sources]
    xs = [j + (i - (len(M) - 1) / 2) * w for j in range(len(sources))]
    ax.bar(xs, vals, w * 0.92, label=NAME[m], color=COLOR[m])
n_by = {s: S["methods"][M[0]]["by_source"].get(s, {}).get("n", 0) for s in sources}
ax.set_xticks(range(len(sources)), [f"{s}\n(n={n_by[s]})" for s in sources])
ax.set_ylabel("Event accuracy (%)")
ax.set_ylim(0, 105)
ax.yaxis.grid(True, alpha=0.3)
ax.set_axisbelow(True)
fig.tight_layout()
fig.savefig(RES / "fig_by_source.pdf")
fig.savefig(RES / "fig_by_source.png", dpi=200)

print("Wrote fig_field_accuracy and fig_by_source (.pdf + .png) to results/")
