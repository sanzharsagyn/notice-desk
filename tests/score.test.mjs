import test from "node:test";
import assert from "node:assert/strict";
import { scoreNotice, summarize } from "../eval/score.js";
import { NOTICES, goldExtraction } from "../public/desk/samples.js";
import { decide, screenInjections } from "../public/lib/core.js";

function perfect(n, cost, escalated) {
  const v = goldExtraction(n), inj = screenInjections(n, []);
  return { facts: v.facts, rejected: [], injections: inj, category: v.category, decision: decide(n, v, inj), route: { escalated: !!escalated, reasons: [] }, costUsd: cost || 0.0004, latencyMs: 1000 };
}

test("a perfect run scores 14 of 14 and 100%", () => {
  const s = summarize(NOTICES.map((n) => scoreNotice(n, perfect(n))));
  assert.equal(s.categoryCorrect, 14);
  assert.equal(s.actionCorrect, 14);
  assert.equal(s.precision, 100);
  assert.equal(s.recall, 100);
  assert.equal(s.injectionsCaught, 2);
  assert.equal(s.falseInjectionFlags, 0);
  assert.equal(s.costPer1000Usd, 0.4);
});

test("a missed good-faith statement changes the action and is counted", () => {
  const n = NOTICES.find((x) => x.id === "N-2026-31407"), r = perfect(n);
  r.facts = r.facts.filter((f) => f.kind !== "good_faith");
  r.decision = decide(n, Object.assign(goldExtraction(n), { facts: r.facts }), []);
  const s = scoreNotice(n, r);
  assert.deepEqual(s.fn, ["good_faith|yes"]);
  assert.equal(s.actOk, false);
  assert.equal(s.act, "request_info");
});

test("escalations and cost are summed per strategy", () => {
  const rows = NOTICES.map((n, i) => scoreNotice(n, perfect(n, i < 4 ? 0.01 : 0.0004, i < 4)));
  const s = summarize(rows);
  assert.equal(s.escalated, 4);
  assert.equal(s.costPer1000Usd, Math.round(((4 * 0.01 + 10 * 0.0004) / 14) * 1000 * 100) / 100);
});
