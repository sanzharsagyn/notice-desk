// Small-sample statistics for the lab. With 14 notices every accuracy has a wide interval, and the page says so.
export function wilson(k, n, z) {
  z = z || 1.96;
  if (!n) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
export function quantile(a, q) {
  if (!a.length) return null;
  const s = a.slice().sort(function (x, y) { return x - y; }), i = q * (s.length - 1), lo = Math.floor(i);
  return lo + 1 < s.length ? s[lo] + (s[lo + 1] - s[lo]) * (i - lo) : s[lo]; // linear interpolation between ranks
}
export const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
