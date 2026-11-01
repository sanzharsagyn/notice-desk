// Re-scores the recorded answers in public/desk/eval-results.json with the current rules and writes eval/RESULTS.md.
// No model calls: use it after changing a rule in core.js or lab.js.   node eval/rescore.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ITEMS } from "../public/desk/samples.js";
import { MODELS, policyLabel } from "../public/lib/models.js";
import { candidatePolicies, scorePolicy, modelStats, pareto, recommend } from "../public/lib/lab.js";
import { report } from "./report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "../public/desk/eval-results.json");
const out = JSON.parse(fs.readFileSync(OUT, "utf8"));
const keys = Object.keys(out.models).filter((k) => MODELS[k] && out.answers[k]);
const scores = candidatePolicies(keys).map((p) => scorePolicy(p, ITEMS, out.answers));
const best = recommend(scores);
out.recommended = best && best.policy;
out.frontier = pareto(scores).map((s) => s.policy);
out.rescoredAt = new Date().toISOString();
const stats = Object.fromEntries(keys.map((k) => [k, modelStats(k, ITEMS, out.answers)]));
fs.writeFileSync(OUT, JSON.stringify(out));
const L = report(out, scores, stats, keys);
fs.writeFileSync(path.join(here, out.endpoint === "local" ? "RESULTS.local.md" : "RESULTS.md"), L.join("\n") + "\n");
console.log("Recommended: " + policyLabel(out.recommended) + ". Wrote eval/RESULTS.md and updated eval-results.json.");
