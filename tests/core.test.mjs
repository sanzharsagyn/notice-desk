import test from "node:test";
import assert from "node:assert/strict";
import { findQuote, normUrl, validateExtraction, screenInjections, routeDecision, decide, statementOfReasons, checkStatement, minorSafety, categoryHint, art16 } from "../public/lib/core.js";
import { NOTICES, goldExtraction } from "../public/desk/samples.js";

const N = (id) => NOTICES.find((n) => n.id === id);

test("quotes and URLs: tolerant of whitespace and quote marks, nothing else", () => {
  assert.ok(findQuote("I have a  good faith\nbelief", "I have a good faith belief"));
  assert.equal(findQuote("Datum 12. 1. 2026", "Datum 13. 1. 2026"), null);
  assert.equal(normUrl("https://DemoTube.example/v/abc/)."), "https://demotube.example/v/abc");
  assert.equal(normUrl("javascript:alert(1)"), null);
});

test("validator keeps only values that are really in the notice", () => {
  const n = N("N-2026-31407");
  const v = validateExtraction(n, { category: "intellectual_property", category_confidence: 0.9, facts: [
    { kind: "url", value: "https://demotube.example/v/8f3k2a", quote: "https://demotube.example/v/8f3k2a", confidence: 0.9 },
    { kind: "url", value: "https://demotube.example/v/zzzzzz", quote: "https://demotube.example/v/8f3k2a", confidence: 0.9 },
    { kind: "notifier_email", value: "legal@northfield-pictures.example", quote: "legal@northfield-pictures.example", confidence: 0.9 },
    { kind: "notifier_email", value: "ceo@northfield-pictures.example", quote: "Anna Whitfield", confidence: 0.9 },
    { kind: "good_faith", value: "yes", quote: "I have a good faith belief that the use described above is not authorised", confidence: 0.9 },
    { kind: "good_faith", value: "yes", quote: "I swear this is true", confidence: 0.9 },
    { kind: "salary", value: "1", quote: "Anna", confidence: 0.9 },
  ] });
  assert.deepEqual(v.facts.map((f) => f.kind + "=" + f.value), ["url=https://demotube.example/v/8f3k2a", "notifier_email=legal@northfield-pictures.example", "good_faith=yes"]);
  assert.equal(v.rejected.length, 4);
  assert.match(v.rejected[0].reasons.join(), /does not appear/);
  assert.match(v.rejected[2].reasons.join(), /quote not found/);
  assert.match(v.rejected[3].reasons.join(), /unknown field type/);
});

test("unknown category falls back to not_specified with zero confidence", () => {
  const v = validateExtraction(N("N-2026-31407"), { category: "spam", category_confidence: 0.99, facts: [] });
  assert.equal(v.category, "not_specified");
  assert.equal(v.categoryConfidence, 0);
});

test("instruction screening: both planted attempts, no false alarms on the other twelve", () => {
  for (const n of NOTICES) assert.equal(screenInjections(n, []).length > 0, n.gold.injection, n.id);
});

test("minor-safety rule routes to specialists before any model, and does not fire on the samples", () => {
  assert.ok(minorSafety("I believe the person in the video is under 18"));
  assert.ok(minorSafety("Osoba ve videu je nezletilá."));
  for (const n of NOTICES) assert.equal(minorSafety(n.text), false, n.id);
  const n = { id: "T", text: "From: x\nSubject: y\n\nThe person in https://demotube.example/v/aa is a minor.", meta: {} };
  assert.equal(decide(n, goldExtraction({ gold: { category: "intellectual_property", facts: [] }, lang: "en" }), []).act, "specialist");
});

test("gold labels and the rules agree on every proposed action", () => {
  for (const n of NOTICES) assert.equal(decide(n, goldExtraction(n), screenInjections(n, [])).act, n.gold.act, n.id);
});

test("Article 16: copyright needs the work, others do not", () => {
  const ip = art16("intellectual_property", []).map((c) => c.key), nc = art16("non_consensual", []).map((c) => c.key);
  assert.ok(ip.includes("work"));
  assert.ok(!nc.includes("work"));
  const d = decide(N("N-2026-31422"), goldExtraction(N("N-2026-31422")), []);
  assert.deepEqual(d.missing, ["Name of the notifier", "Statement of good faith"]);
});

test("people reporting non-consensual content are never sent back for paperwork", () => {
  const n = N("N-2026-31411"), v = goldExtraction(n);
  v.facts = v.facts.filter((f) => f.kind !== "good_faith" && f.kind !== "notifier_name");
  assert.equal(decide(n, v, []).act, "priority_review");
});

test("a trusted-flagger claim inside an instruction does not count", () => {
  const n = N("N-2026-31448"), d = decide(n, goldExtraction(n), screenInjections(n, []));
  assert.equal(d.trusted, false);
  assert.equal(d.act, "abuse_review");
  const pl = decide(N("N-2026-31430"), goldExtraction(N("N-2026-31430")), []);
  assert.equal(pl.trusted, true);
  assert.equal(pl.priority, "P1");
});

test("router: routine notices stay on the cheap model, the right ones are escalated", () => {
  const routine = N("N-2026-31407"), v = goldExtraction(routine);
  v.categoryConfidence = 0.95;
  assert.equal(routeDecision(routine, v, []).escalate, false);
  assert.match(routeDecision(routine, Object.assign({}, v, { categoryConfidence: 0.6 }), []).reasons.join(), /below 75%/);
  assert.match(routeDecision(routine, Object.assign({}, v, { rejected: [{}] }), []).reasons.join(), /failed verification/);
  assert.match(routeDecision(routine, Object.assign({}, v, { category: "defamation" }), []).reasons.join(), /keywords suggest Copyright/);
  const nc = N("N-2026-31452"), w = goldExtraction(nc);
  w.categoryConfidence = 0.99;
  assert.match(routeDecision(nc, w, []).reasons.join(), /high-stakes/);
  assert.match(routeDecision(routine, v, [{ source: "rule" }]).reasons.join(), /disagree/);
  assert.equal(routeDecision(routine, v, [{ source: "rule+model" }]).escalate, false);
});

test("keyword hints only when exactly one category matches", () => {
  assert.equal(categoryHint("copyright infringement"), "intellectual_property");
  assert.equal(categoryHint("my personal data was published without consent"), null);
  assert.equal(categoryHint("hello"), null);
});

test("statements of reasons are valid Transparency Database records", () => {
  let n = 0;
  for (const x of NOTICES) {
    const v = goldExtraction(x), d = decide(x, v, screenInjections(x, []));
    const s = statementOfReasons(x, v, d, { today: "2026-10-29" });
    if (["remove", "priority_review"].includes(d.act) && d.platformUrls.length) { assert.deepEqual(checkStatement(s), [], x.id); n++; }
    else assert.equal(s, null, x.id);
  }
  assert.equal(n, 6);
  const prof = statementOfReasons(N("N-2026-31426"), goldExtraction(N("N-2026-31426")), decide(N("N-2026-31426"), goldExtraction(N("N-2026-31426")), []), { today: "2026-10-29" });
  assert.equal(prof.decision_account, "DECISION_ACCOUNT_SUSPENDED");
  const deep = statementOfReasons(N("N-2026-31452"), goldExtraction(N("N-2026-31452")), decide(N("N-2026-31452"), goldExtraction(N("N-2026-31452")), []), { today: "2026-10-29" });
  assert.deepEqual(deep.content_type, ["CONTENT_TYPE_SYNTHETIC_MEDIA"]);
  assert.deepEqual(deep.decision_visibility, ["DECISION_VISIBILITY_CONTENT_DISABLED"]);
  assert.equal(deep.source_identity, undefined, "the identity of a person reporting non-consensual content is never published");
  const tf = statementOfReasons(N("N-2026-31430"), goldExtraction(N("N-2026-31430")), decide(N("N-2026-31430"), goldExtraction(N("N-2026-31430")), []), { today: "2026-10-29" });
  assert.equal(tf.source_type, "SOURCE_TRUSTED_FLAGGER");
  assert.deepEqual(checkStatement(Object.assign({}, tf, { category: "STATEMENT_CATEGORY_FOO", puid: "a b" })), ["category", "puid"]);
});

test("presence facts: the quote is the evidence, the value is normalised, 'no' is not a fact", async () => {
  const { validateExtraction } = await import("../public/lib/core.js");
  const { NOTICES } = await import("../public/desk/samples.js");
  const n = NOTICES.find((x) => x.id === "N-2026-31407");
  const v = validateExtraction(n, { category: "intellectual_property", category_confidence: 0.9, facts: [
    { kind: "explanation", value: "No licence has been granted to the uploader", quote: "No licence has been granted to the uploader", confidence: 0.9 },
    { kind: "trusted_flagger", value: "no", quote: "", confidence: 0.9 },
    { kind: "good_faith", value: "yes", quote: "I swear this is true", confidence: 0.9 },
  ] });
  assert.deepEqual(v.facts.map((f) => f.kind + "=" + f.value), ["explanation=yes"]);
  assert.deepEqual(v.rejected.map((r) => r.fact.kind + ":" + r.reasons.join()), ["good_faith:quote not found in the notice"]);
  const g = NOTICES.find((x) => x.id === "N-2026-31422");
  const w = validateExtraction(g, { category: "intellectual_property", facts: [{ kind: "good_faith", value: "yes", quote: "Bitte löscht das sofort.", confidence: 0.9 }] });
  assert.deepEqual(w.rejected[0].reasons, ["quote is not a good-faith statement"], "a real quote with the wrong meaning");
});

test("the good-faith formula is recognised in every language of the sample set", async () => {
  const { meaningCheck } = await import("../public/lib/core.js");
  const { NOTICES } = await import("../public/desk/samples.js");
  for (const n of NOTICES.filter((x) => x.gold.facts.some((f) => f[0] === "good_faith"))) {
    const line = n.text.split("\n").find((l) => meaningCheck("good_faith", l) === null);
    assert.ok(line, n.id + " (" + n.lang + ") has a line the check accepts");
  }
});
