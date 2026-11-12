from noticedesk_eval.stats import quantile, wilson


def test_wilson_interval():
    lo, hi = wilson(14, 14)
    assert 0.78 < lo < 0.79 and hi == 1
    a, b = wilson(7, 14)
    assert abs(a + b - 1) < 1e-9, "symmetric around one half"
    assert wilson(0, 0) == [0, 0]


def test_quantile_interpolates_between_ranks():
    assert quantile([1, 2, 3, 4], 0.5) == 2.5
    assert abs(quantile([4, 1, 3, 2], 0.95) - 3.85) < 1e-12  # 3.8499999999999996 in both languages
    assert quantile([5], 0.95) == 5
    assert quantile([], 0.5) is None
