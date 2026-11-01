// The lab's evaluation: every model on every sample notice and attack, through the deployed API.
//   node eval/run.mjs https://noticedesk.<subdomain>.workers.dev                 all models, then a Claude batch
//   node eval/run.mjs https://noticedesk.<subdomain>.workers.dev --no-batch
//   node eval/run.mjs https://noticedesk.<subdomain>.workers.dev --models haiku,llama-3.1-8b-fast
// Answers are cached by the Worker, so a re-run only pays for what is missing. The analysis (router policies,
// Pareto frontier, recommendation) is computed from the recorded answers by public/lib/lab.js, the same code the page uses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOTICES, ATTACKS, ITEMS, SAMPLES_VERSION } from "../public/desk/samples.js";
import { MODELS, MODEL_KEYS, policyLabel } from "../public/lib/models.js";
import { candidatePolicies, scorePolicy, modelStats, pareto, recommend } from "../public/lib/lab.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) { console.error("Usage: node eval/run.mjs https://noticedesk.<your-subdomain>.workers.dev"); process.exit(1); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(base);
const publish = !local || process.argv.includes("--publish-local");
const OUT = path.join(here, "../public/desk/eval-results.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, body) {
  const res = await fetch(base + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((j.message || j.error || res.status) + (j.upstream ? " | " + j.upstream : "")), { status: res.status });
  return j;
}

// 1. Which open models does this account run?
let resolved = {}, unavailable = {};
try { const pr = await api("/api/v1/probe", {}); resolved = pr.resolved || {}; for (const [k, e] of Object.entries(pr.errors || {})) if (!resolved[k] && (unavailable[k] = e)) console.log("  not available: " + k + "  (" + e.slice(0, 140) + ")"); }
catch (e) { console.log("Probe skipped: " + e.message); try { resolved = Object.fromEntries((await api("/api/v1/models")).models.filter((m) => m.id && m.provider === "workers-ai").map((m) => [m.key, m.id])); } catch (_) { /* none */ } }
const wanted = (arg("--models") || MODEL_KEYS.join(",")).split(",").filter((k) => MODELS[k]);
const keys = wanted.filter((k) => MODELS[k].provider === "anthropic" || resolved[k]);
console.log("Models: " + keys.map((k) => MODELS[k].label).join(", ") + "\n");

// 2. Every model on every item. Two calls in flight at a time; failures are recorded, not fatal.
// Answers from an earlier run are reused only if they come from the same prompt and samples. Otherwise the earlier
// run's scores go into the history, so the page can show what a prompt change did to each model.
const health = await api("/api/v1/health");
const PROMPT = health.prompt;
let prevFile = null, prev = {}, history = [];
try { prevFile = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { prevFile = null; }
if (prevFile) {
  const prevPrompt = prevFile.prompt || "n2";
  history = (prevFile.history || []).filter((h) => h.prompt !== PROMPT);
  if (prevPrompt === PROMPT && prevFile.samplesVersion === SAMPLES_VERSION) prev = prevFile.answers || {};
  else if (!history.some((h) => h.prompt === prevPrompt)) {
    const pk = Object.keys(prevFile.answers || {}).filter((k) => MODELS[k]);
    history.push({ prompt: prevPrompt, ranAt: prevFile.ranAt, models: Object.fromEntries(pk.map((k) => {
      const s = scorePolicy([k], ITEMS, prevFile.answers), m = modelStats(k, ITEMS, prevFile.answers);
      return [k, { actionCorrect: s.actionCorrect, f1: s.f1, attacksStopped: s.attacksStopped, jsonErrors: m.jsonErrors, rejectedShare: m.rejectedShare, falseAlarms: m.falseAlarms, costPer1000: s.costPer1000 }];
    })) });
    console.log("Prompt changed from " + prevPrompt + " to " + PROMPT + ": the earlier scores are kept as history.");
  }
}
const answers = {}, errors = {};
let quotaOut = false; // the Workers AI daily allowance is used up: skip the remaining open-model calls, keep earlier answers
for (const k of keys) {
  answers[k] = {};
  if (quotaOut && MODELS[k].provider === "workers-ai") {
    errors[k] = "Workers AI daily allowance used up; run again after 00:00 UTC";
    if (prev[k]) answers[k] = prev[k];
    console.log("  " + MODELS[k].label.padEnd(24) + " skipped: " + errors[k]);
    continue;
  }
  const queue = ITEMS.slice();
  let done = 0, fresh = 0;
  async function worker() {
    for (let it = queue.shift(); it; it = queue.shift()) {
      if (quotaOut && MODELS[k].provider === "workers-ai") { if (prev[k] && prev[k][it.id]) answers[k][it.id] = prev[k][it.id]; continue; }
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { const r = await api("/api/v1/run", { itemId: it.id, model: k }); answers[k][it.id] = r.step; if (!r.cached) fresh++; break; }
        catch (e) {
          if (/neuron|allocation|quota/i.test(e.message)) quotaOut = true;
          if (e.status === 429 || quotaOut || attempt === 3) { errors[k] = e.message; if (prev[k] && prev[k][it.id]) answers[k][it.id] = prev[k][it.id]; break; }
          await sleep(2500 * attempt);
        }
      }
      done++;
      process.stdout.write("  " + MODELS[k].label.padEnd(24) + " " + done + "/" + ITEMS.length + "\r");
    }
  }
  await Promise.all([worker(), worker()]);
  console.log("  " + MODELS[k].label.padEnd(24) + " " + Object.keys(answers[k]).length + "/" + ITEMS.length + " answered, " + fresh + " fresh" + (errors[k] ? "  last error: " + errors[k].slice(0, 120) : ""));
}

// 3. Optional: the cheap Claude model over the whole inbox as one Message Batch.
let batch = null;
if (!process.argv.includes("--no-batch") && keys.includes("haiku")) {
  try {
    const b = await api("/api/v1/batch", { model: "haiku" });
    console.log("\nBatch " + b.id + " queued with " + b.requests + " notices, waiting (usually a few minutes)...");
    const t0 = Date.now();
    for (;;) {
      const r = await api("/api/v1/batch/" + b.id);
      if (r.status === "ended") { batch = { id: b.id, wallClockMs: r.wallClockMs, costPer1000: (r.results.reduce((a, x) => a + x.costUsd, 0) / r.results.length) * 1000, actionCorrect: r.results.filter((x) => (NOTICES.find((n) => n.id === x.noticeId) || {}).gold.act === x.decision.act).length, n: r.results.length }; break; }
      if (Date.now() - t0 > 20 * 60000) { console.log("Batch still running after 20 minutes; the page shows the rest. Re-run later to include it."); break; }
      await sleep(20000);
    }
  } catch (e) { console.log("Batch skipped: " + e.message); }
}

// 4. Analysis, with the same code the page runs.
const scores = candidatePolicies(keys).map((p) => scorePolicy(p, ITEMS, answers));
const front = pareto(scores), best = recommend(scores);
const stats = Object.fromEntries(keys.map((k) => [k, modelStats(k, ITEMS, answers)]));
const out = { ranAt: new Date().toISOString(), samplesVersion: SAMPLES_VERSION, prompt: PROMPT, history: history, endpoint: local ? "local" : base, notices: NOTICES.length, attacks: ATTACKS.length,
  models: Object.fromEntries(keys.map((k) => [k, { label: MODELS[k].label, modelId: k in resolved ? resolved[k] : MODELS[k].ids[0], error: errors[k] || null }])),
  unavailable: unavailable, answers: answers, batch: batch, recommended: best && best.policy, frontier: front.map((s) => s.policy) };
if (publish) fs.writeFileSync(OUT, JSON.stringify(out));

const L = ["# Model lab results", "", "Run " + out.ranAt + " on " + NOTICES.length + " notices and " + ATTACKS.length + " attacks (samples " + SAMPLES_VERSION + ").", "",
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
fs.writeFileSync(path.join(here, local ? "RESULTS.local.md" : "RESULTS.md"), L.join("\n") + "\n");
console.log("\n" + L.slice(4, 6 + scores.length).join("\n"));
console.log("\nRecommended: " + (best ? policyLabel(best.policy) : "none"));
console.log(publish ? "Wrote public/desk/eval-results.json. Deploy again to publish it: npx wrangler deploy" : "Local run: not written to the site (add --publish-local).");
