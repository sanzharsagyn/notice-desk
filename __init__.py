"""Notice Desk evaluation in Python: replays router policies over recorded model answers, scores them against
the reference labels, finds the cost-quality frontier and picks the recommendation.

A port of public/lib/lab.js, stats.js and the rules in core.js that the analysis uses. The two implementations
are checked against each other on the real recorded answers (tests/test_parity.py).
"""

from .lab import analyse, candidate_policies, model_stats, pareto, recommend, replay_item, score_policy
from .stats import quantile, wilson

__all__ = ["analyse", "candidate_policies", "model_stats", "pareto", "recommend", "replay_item", "score_policy",
           "quantile", "wilson"]
