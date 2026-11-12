"""The Python port against the JavaScript original, on the same recorded answers.

Runs the JS lab through Node (eval/parity-dump.mjs) and compares every policy score, every per-model statistic,
every replayed item (escalation, router reasons, action, kept facts, cost, time), the Pareto frontier and the
recommendation. Real answers from the n3 run, the same answers with the meaning check off, and degraded copies
that exercise missing answers, broken JSON, low confidence and false alarms.
"""

from __future__ import annotations

import copy
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

from noticedesk_eval import data
from noticedesk_eval.lab import analyse, candidate_policies, replay_item
from noticedesk_eval.rules import category_hint, meaning_check, minor_safety, on_platform

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "public" / "desk" / "eval-results.json"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="Node.js is needed to run the JavaScript side")


def node(*args: str) -> str:
    return subprocess.run([NODE, *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def same(a, b, path="") -> None:
    """Deep equality; numbers compare with 1e-12 tolerance (both sides are IEEE doubles in the same order of
    operations, so in practice they are bit-identical)."""
    if isinstance(a, bool) or isinstance(b, bool):
        assert a == b, path
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        assert math.isclose(a, b, rel_tol=0, abs_tol=1e-12), f"{path}: {a} != {b}"
    elif isinstance(a, dict) and isinstance(b, dict):
        assert a.keys() == b.keys(), f"{path}: keys {sorted(set(a) ^ set(b))}"
        for k in a:
            same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        assert len(a) == len(b), f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, f"{path}[{i}]")
    else:
        assert a == b, f"{path}: {a!r} != {b!r}"


def degraded(results: dict, seed: int) -> dict:
    """A deterministic copy with holes and noise, so the rarely used code paths are compared too."""
    r = copy.deepcopy(results)
    for mi, (k, by_item) in enumerate(r["answers"].items()):
        for ii, item_id in enumerate(list(by_item)):
            n = mi * 31 + ii + seed
            if n % 5 == 0:
                del by_item[item_id]  # missing answer: the replay uses the empty, failed answer
                continue
            a = by_item[item_id]
            if n % 4 == 1:
                # below, exactly at and just above the router threshold, and halves where JS Math.round and
                # Python round disagree (62.5 -> 63 in JS, 62 with Python's round)
                a["categoryConfidence"] = [0.5, 0.75, 0.625, 0.125, 0.76][n % 5]
            if n % 6 == 2:
                a["inj"] = a["inj"] + ["model"]  # a model-only flag: a false alarm on a clean notice
            if n % 7 == 3:
                a["jsonError"] = True
                a["facts"] = []
            if n % 9 == 4:
                a["category"] = "defamation"  # high-stakes category: always escalated
    return r


def python_side(results: dict, meaning: bool) -> dict:
    out = analyse(results, meaning_checks=meaning)
    keys = [k for k in results["models"] if k in data.MODELS]
    out["replays"] = {
        ">".join(p): [{k: r[k] for k in ("escalated", "reasons", "act", "category", "kept", "costUsd", "latencyMs", "failed")}
                      | {"id": r["item"]["id"]} for r in (replay_item(it, p, results["answers"], meaning) for it in data.ITEMS)]
        for p in candidate_policies(keys)
    }
    return out


def js_side(results: dict, meaning: bool, tmp: Path) -> dict:
    f = tmp / "results.json"
    f.write_text(json.dumps(results), encoding="utf-8")
    args = ["eval/parity-dump.mjs", str(f)] + ([] if meaning else ["--no-meaning-check"])
    return json.loads(node(*args))


def test_fixture_is_current():
    """fixture.json must be what the JavaScript modules export today."""
    committed = (ROOT / "py" / "noticedesk_eval" / "fixture.json").read_text(encoding="utf-8")
    assert node("eval/export-fixture.mjs", "--stdout") == committed, "run: node eval/export-fixture.mjs"


@pytest.mark.parametrize("meaning", [True, False], ids=["meaning-check", "no-meaning-check"])
@pytest.mark.parametrize("variant", ["real", "degraded-1", "degraded-2", "degraded-3"])
def test_lab_matches_javascript(variant, meaning, tmp_path):
    results = json.loads(RESULTS.read_text(encoding="utf-8"))
    if variant != "real":
        results = degraded(results, int(variant[-1]))
    js, py = js_side(results, meaning, tmp_path), python_side(results, meaning)
    assert js["recommended"] == py["recommended"]
    assert js["frontier"] == py["frontier"]
    same(js["stats"], py["stats"], "stats")
    same(js["scores"], py["scores"], "scores")
    same(js["replays"], py["replays"], "replays")


def test_rules_match_javascript_on_text_edge_cases(tmp_path):
    """JS regexes without the u flag treat only ASCII as word characters; the port must too."""
    results = json.loads(RESULTS.read_text(encoding="utf-8"))
    texts = [it["text"] for it in data.ITEMS] + [
        "osobních údajů", "osobni udaje", "OSOBNÍ ÚDAJE", "Ochrana osobních údajů (GDPR)", "émineur", "un mineur", "Mineurs",
        "children's channel", "child-safety team", "UNDER 18", "under18", "underage", "under-age", "a minorities report",
        "НЕСОВЕРШЕННОЛЕТНИЙ", "Неповнолітня", "Copyright and licence", "licensed", "deepfake of me", "pretending to be me",
        "Pretended to be", "praw autorskich", "prawa autorskie", "diritti d'autore", "Verleumdung und Urheberrecht", "",
    ]
    quotes = sorted({f[2] for by in results["answers"].values() for a in by.values() for f in a["facts"] if len(f) > 2}) + [
        "Te Goeder Trouw", "GOOD-FAITH", "good  faith", "goodfaith", "Bitte löscht das sofort.", "v dobré víře",
        "V DOBRÉ VÍŘE", "добросовестно", "ДОБРОСОВІСНО", "", "in Gutem Glauben"]
    urls = ["https://demotube.example/v/x", "https://DemoTube.example/v/x", "https://demotube.example:443/v/x",
            "http://demotube.example:8080/v/x", "https://evil.example/v/x", "https://demotube.example.evil.example/v",
            "yes", "mailto:a@demotube.example", "ftp://demotube.example/x", "https://user@demotube.example/v"]
    h = tmp_path / "helpers.json"
    h.write_text(json.dumps({"texts": texts, "quotes": quotes, "urls": urls}), encoding="utf-8")
    f = tmp_path / "results.json"
    f.write_text(json.dumps(results), encoding="utf-8")
    js = json.loads(node("eval/parity-dump.mjs", str(f), "--helpers", str(h)))["helpers"]
    assert js["minor"] == [minor_safety(t) for t in texts]
    assert js["hint"] == [category_hint(t) for t in texts]
    assert js["meaning"] == [meaning_check("good_faith", q) for q in quotes]
    assert js["platform"] == [on_platform(u) for u in urls]
