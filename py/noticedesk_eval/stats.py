"""Small-sample statistics. Port of public/lib/stats.js.

With 14 notices every accuracy has a wide interval, so the lab reports one.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence


def wilson(k: int, n: int, z: float = 1.96) -> list[float]:
    """95% Wilson score interval for k successes out of n."""
    if not n:
        return [0, 0]
    p = k / n
    d = 1 + (z * z) / n
    c = p + (z * z) / (2 * n)
    m = z * math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
    return [max(0, (c - m) / d), min(1, (c + m) / d)]


def quantile(values: Sequence[float], q: float) -> Optional[float]:
    """Quantile with linear interpolation between ranks (the same rule as the page)."""
    if not values:
        return None
    s = sorted(values)
    i = q * (len(s) - 1)
    lo = math.floor(i)
    if lo + 1 < len(s):
        return s[lo] + (s[lo + 1] - s[lo]) * (i - lo)
    return s[lo]
