"""Command line: re-score recorded answers without any model call.

    python -m noticedesk_eval public/desk/eval-results.json
    python -m noticedesk_eval public/desk/eval-results.json --no-meaning-check   what the meaning check changed
    python -m noticedesk_eval public/desk/eval-results.json --json               everything as JSON
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .data import MODELS
from .lab import analyse


def _label(policy: str) -> str:
    return " → ".join(MODELS[k]["label"] for k in policy.split(">"))


def _sec(ms):
    return "–" if ms is None else f"{ms / 1000:.1f} s"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="noticedesk_eval", description=__doc__.splitlines()[0])
    ap.add_argument("results", type=Path, help="eval-results.json written by eval/run.mjs")
    ap.add_argument("--no-meaning-check", action="store_true", help="score without the good-faith meaning check")
    ap.add_argument("--json", action="store_true", help="print the full analysis as JSON")
    ap.add_argument("--top", type=int, default=10, help="policies to list (default 10)")
    a = ap.parse_args(argv)

    results = json.loads(a.results.read_text(encoding="utf-8"))
    out = analyse(results, meaning_checks=not a.no_meaning_check)
    if a.json:
        json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
        print()
        return 0

    print(f"Prompt {results.get('prompt', '?')}, samples {results.get('samplesVersion', '?')}, "
          f"{len(out['stats'])} models, {len(out['scores'])} policies"
          + (" (meaning check off)" if a.no_meaning_check else ""))
    print("\nModels")
    print(f"  {'model':<26}{'actions':>9}{'F1':>8}{'JSON':>7}{'rejected':>10}{'complied':>10}{'false alarms':>14}{'p95':>8}")
    by_key = {s["policy"]: s for s in out["scores"]}
    for k, m in sorted(out["stats"].items(), key=lambda kv: (-by_key[kv[0]]["actionCorrect"], -by_key[kv[0]]["f1"])):
        s = by_key[k]
        print(f"  {MODELS[k]['label']:<26}{s['actionCorrect']:>6}/{s['n']:<2}{s['f1'] * 100:>7.1f}%{m['jsonErrors']:>4}/{m['answered']:<2}"
              f"{m['rejectedShare'] * 100:>9.1f}%{m['attackComplied']:>7}/{m['attacksRun']:<2}{m['falseAlarms']:>11}/{m['cleanRun']:<2}{_sec(m['latencyP95']):>8}")
    front = set(out["frontier"])
    print(f"\nPolicies (top {a.top} by correct actions, attacks stopped, cost)")
    ranked = sorted(out["scores"], key=lambda s: (-s["actionCorrect"], -s["attacksStopped"], s["costPer1000"]))
    for s in ranked[: a.top]:
        mark = "*" if s["policy"] in front else " "
        print(f" {mark}{_label(s['policy']):<52}{s['actionCorrect']:>3}/{s['n']}  F1 {s['f1'] * 100:5.1f}%  "
              f"attacks {s['attacksStopped']}/{s['attacks']}  ${s['costPer1000']:.3f}/1000  p95 {_sec(s['latencyP95'])}")
    print("  * on the cost-quality frontier")
    print(f"\nRecommended: {_label(out['recommended'])}" if out["recommended"] else "\nNo answers to score.")
    return 0
