// Prints what the JavaScript lab computes from recorded answers, for the Python parity test (py/tests/test_parity.py).
//   node eval/parity-dump.mjs results.json [--no-meaning-check] [--helpers strings.json]
import fs from "node:fs";
import { ITEMS } from "../public/desk/samples.js";
import { MODELS } from "../public/lib/models.js";
import { candidatePolicies, scorePolicy, modelStats, pareto, recommend, replayItem, setMeaningChecks } from "../public/lib/lab.js";
import { minorSafety, categoryHint, meaningCheck, onPlatform } from "../public/lib/core.js";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const results = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
setMeaningChecks(!process.argv.includes("--no-meaning-check"));
const answers = results.answers, keys = Object.keys(results.models).filter((k) => MODELS[k]);
const policies = candidatePolicies(keys);
const scores = policies.map((p) => scorePolicy(p, ITEMS, answers));
const rec = recommend(scores);
const out = {
  scores,
  stats: Object.fromEntries(keys.map((k) => [k, modelStats(k, ITEMS, answers)])),
  frontier: pareto(scores).map((s) => s.policy),
  recommended: rec ? rec.policy : null,
  replays: Object.fromEntries(policies.map((p) => [p.join(">"), ITEMS.map((it) => {
    const r = replayItem(it, p, answers);
    return { id: it.id, escalated: r.escalated, reasons: r.reasons, act: r.act, category: r.category, kept: r.kept, costUsd: r.costUsd, latencyMs: r.latencyMs, failed: r.failed };
  })])),
};
const hp = arg("--helpers");
if (hp) {
  const h = JSON.parse(fs.readFileSync(hp, "utf8"));
  out.helpers = {
    minor: h.texts.map((t) => minorSafety(t)), hint: h.texts.map((t) => categoryHint(t)),
    meaning: h.quotes.map((q) => meaningCheck("good_faith", q)), platform: h.urls.map((u) => onPlatform(u)),
  };
}
process.stdout.write(JSON.stringify(out));
