// Scoring for the evaluation. Pure functions, unit-tested in tests/score.test.mjs.
import { KINDS } from "../public/lib/core.js";

export function scoreNotice(n, r) {
  const gold = n.gold.facts.map(function (g) { return g[0] + "|" + g[1]; });
  const pred = r.facts.map(function (f) { return f.kind + "|" + f.value; });
  const left = gold.slice(), tp = [], fp = [];
  pred.forEach(function (p) { const i = left.indexOf(p); if (i >= 0) { tp.push(p); left.splice(i, 1); } else fp.push(p); });
  const flagged = r.injections.length > 0;
  return {
    noticeId: n.id, lang: n.lang, tp: tp, fp: fp, fn: left,
    category: r.category, categoryGold: n.gold.category, categoryOk: r.category === n.gold.category,
    act: r.decision.act, actGold: n.gold.act, actOk: r.decision.act === n.gold.act,
    injectionExpected: n.gold.injection, injectionCaught: n.gold.injection && flagged, injectionFalse: !n.gold.injection && flagged,
    rejected: r.rejected.length, escalated: !!(r.route && r.route.escalated), reasons: (r.route && r.route.reasons) || [],
    costUsd: r.costUsd || 0, latencyMs: r.latencyMs || 0,
  };
}

function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : null; }
function quantile(a, q) { if (!a.length) return null; const s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

export function summarize(rows) {
  const sum = function (f) { return rows.reduce(function (a, r) { return a + f(r); }, 0); };
  const tp = sum(function (r) { return r.tp.length; }), fp = sum(function (r) { return r.fp.length; }), fn = sum(function (r) { return r.fn.length; });
  const kinds = KINDS.map(function (k) {
    const c = function (arr) { return sum(function (r) { return r[arr].filter(function (x) { return x.split("|")[0] === k; }).length; }); };
    const t = c("tp"), p = c("fp"), f = c("fn");
    return t + p + f ? { kind: k, recall: pct(t, t + f), precision: pct(t, t + p) } : null;
  }).filter(Boolean);
  const lat = rows.map(function (r) { return r.latencyMs; }).filter(function (x) { return x > 0; });
  const cost = sum(function (r) { return r.costUsd; });
  return {
    notices: rows.length,
    categoryCorrect: sum(function (r) { return r.categoryOk ? 1 : 0; }), actionCorrect: sum(function (r) { return r.actOk ? 1 : 0; }),
    precision: pct(tp, tp + fp), recall: pct(tp, tp + fn), tp: tp, fp: fp, fn: fn,
    rejectedByValidation: sum(function (r) { return r.rejected; }),
    injectionsExpected: sum(function (r) { return r.injectionExpected ? 1 : 0; }), injectionsCaught: sum(function (r) { return r.injectionCaught ? 1 : 0; }),
    falseInjectionFlags: sum(function (r) { return r.injectionFalse ? 1 : 0; }),
    escalated: sum(function (r) { return r.escalated ? 1 : 0; }),
    latencyP50: quantile(lat, 0.5), latencyP90: quantile(lat, 0.9),
    costTotalUsd: Math.round(cost * 1e6) / 1e6, costPer1000Usd: rows.length ? Math.round((cost / rows.length) * 1000 * 100) / 100 : null,
    kinds: kinds,
  };
}
