// The results as Markdown. Shared by run.mjs (after a run) and rescore.mjs (recorded answers, current rules).
import { NOTICES, ATTACKS } from "../public/desk/samples.js";
import { MODELS, policyLabel } from "../public/lib/models.js";

export function report(out, scores, stats, keys) {
  const SAMPLES_VERSION = out.samplesVersion, PROMPT = out.prompt, history = out.history || [], batch = out.batch;
const L = ["# Model lab results", "", "Run " + out.ranAt + (out.rescoredAt ? ", re-scored " + out.rescoredAt + " with the current rules" : "") + " on " + NOTICES.length + " notices and " + ATTACKS.length + " attacks (samples " + SAMPLES_VERSION + ").", "",
  "| Policy | Correct actions | Fact F1 | Attacks stopped | Attacks that got through | Sent to second model | Cost per 1,000 notices | p50 | p95 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
scores.slice().sort((a, b) => b.actionCorrect - a.actionCorrect || a.costPer1000 - b.costPer1000).forEach((s) => {
  L.push("| " + policyLabel(s.policy) + (s.policy === out.recommended ? " **(recommended)**" : "") + (out.frontier.includes(s.policy) ? " ·frontier" : "") + " | " + s.actionCorrect + "/" + s.n + " | " + (s.f1 * 100).toFixed(1) + "% | " + s.attacksStopped + "/" + s.attacks + " | " + s.attacksEndToEnd + " | " + s.escalated + " | $" + s.costPer1000.toFixed(3) + " | " + (s.latencyP50 ? (s.latencyP50 / 1000).toFixed(1) + " s" : "–") + " | " + (s.latencyP95 ? (s.latencyP95 / 1000).toFixed(1) + " s" : "–") + " |");
});
L.push("", "## Per model", "", "| Model | Broken JSON | Rejected values | False instruction alarms | Complied with attacks | Flagged attacks itself |", "| --- | --- | --- | --- | --- | --- |");
keys.forEach((k) => { const s = stats[k]; L.push("| " + MODELS[k].label + " | " + s.jsonErrors + "/" + s.answered + " | " + (s.rejectedShare * 100).toFixed(1) + "% | " + s.falseAlarms + "/" + s.cleanRun + " | " + s.attackComplied + "/" + s.attacksRun + " | " + s.attackFlaggedByModel + "/" + s.attacksRun + " |"); });
history.forEach((h) => {
  L.push("", "## Prompt " + h.prompt + " → " + PROMPT + " (correct actions, fact F1, false alarms)", "", "| Model | " + h.prompt + " | " + PROMPT + " |", "| --- | --- | --- |");
  keys.filter((k) => h.models[k]).forEach((k) => { const a = h.models[k], s = scores.find((x) => x.policy === k), b = stats[k];
    L.push("| " + MODELS[k].label + " | " + a.actionCorrect + "/14, " + (a.f1 * 100).toFixed(1) + "%, " + a.falseAlarms + " | " + s.actionCorrect + "/" + s.n + ", " + (s.f1 * 100).toFixed(1) + "%, " + b.falseAlarms + " |"); });
});
if (batch) L.push("", "Batch (Claude Haiku 5.5, Message Batches API): " + batch.actionCorrect + "/" + batch.n + " correct actions, $" + batch.costPer1000.toFixed(3) + " per 1,000 notices, " + Math.round(batch.wallClockMs / 1000) + " s wall clock.");
  return L;
}
