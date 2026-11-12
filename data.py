"""The sample items, the model registry and the router constants.

They come from fixture.json, which `node eval/export-fixture.mjs` writes from the same JavaScript modules the
Worker and the page use, so the two implementations never hold two copies of the reference labels or prices.
tests/test_parity.py fails if the committed fixture is out of date.
"""

from __future__ import annotations

import json
from pathlib import Path

_FIXTURE = json.loads((Path(__file__).with_name("fixture.json")).read_text(encoding="utf-8"))

SAMPLES_VERSION: str = _FIXTURE["samplesVersion"]
ITEMS: list[dict] = _FIXTURE["items"]
NOTICES: list[dict] = [it for it in ITEMS if not it["attack"]]
ATTACKS: list[dict] = [it for it in ITEMS if it["attack"]]
MODELS: dict[str, dict] = _FIXTURE["models"]
STRONG: list[str] = _FIXTURE["strong"]
ROUTER: dict = _FIXTURE["router"]
CATEGORY_LABELS: dict[str, str] = _FIXTURE["categoryLabels"]
PLATFORM_HOST: str = _FIXTURE["platformHost"]
F1_TOLERANCE: float = _FIXTURE["f1Tolerance"]
COST_TOLERANCE: float = _FIXTURE["costTolerance"]
