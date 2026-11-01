// Cloudflare Worker: serves the site and the API of the lab.
//   POST /api/v1/run         { itemId, model } one model on one sample notice or attack (cached): the lab's raw material
//   POST /api/v1/probe       finds which Workers AI model ids this account can run
//   GET  /api/v1/models      the models, their prices and which ids resolved
//   POST /api/v1/triage      { noticeId | notice:{ subject, from, text }, policy } through a router policy such as "llama-3.1-8b-fast>sonnet"
//   POST /api/v1/batch       { model } queues every sample notice in one Message Batch (50% price)
//   GET  /api/v1/batch/{id}  batch status; once it has ended, the validated results
//   POST /api/v1/feedback    { ai, decision } a moderator's decision next to the proposal
//   GET  /api/v1/metrics     daily counters for the monitoring page
//   GET  /api/v1/health, /api/openapi.json
// A policy is one model ("sonnet") or a cheap model and a strong one ("llama-3.1-8b-fast>sonnet"): code decides when the strong one must look again.

import { runModel, finish, routeDecision, createBatch, getBatch, batchResults, readAnswer, PROMPT_VERSION } from "./extract.js";
import { MODELS, parsePolicy } from "../public/lib/models.js";
import { compact } from "../public/lib/lab.js";
import { openapi } from "./openapi.js";
import { minorSafety, ACTIONS } from "../public/lib/core.js";
import { NOTICES, ITEMS, SAMPLES_VERSION } from "../public/desk/samples.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
export const LIMITS = { charsPerNotice: 5000, perIpPerDay: 6, batchesPerDay: 3, probesPerDay: 6, feedbackPerIpPerDay: 60 };
export const DEFAULT_POLICY = "haiku>sonnet";
const today = () => new Date().toISOString().slice(0, 10);
function json(data, status, extra) { return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({}, JSON_HEADERS, extra || {}) }); }
async function sha256(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(function (x) { return x.toString(16).padStart(2, "0"); }).join(""); }
async function bump(env, key, limit, ttl) {
  const cur = parseInt((await env.KV.get(key)) || "0", 10);
  if (cur >= limit) return false;
  await env.KV.put(key, String(cur + 1), { expirationTtl: ttl });
  return true;
}
function clean(s, max) { return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max); }

// ---------- monitoring: one JSON document per day in KV (read-modify-write; fine for a demo) ----------
const LAT_BUCKETS = [2000, 4000, 8000, 16000];
function emptyDay(day) {
  return { day: day, notices: 0, modelCalls: 0, byModel: {}, escalations: 0, rulesOnly: 0, batchCalls: 0, errors: 0, limited: 0, latencyMs: 0, latency: [0, 0, 0, 0, 0],
    costUsd: 0, facts: 0, rejected: 0, injections: 0, cacheReadTokens: 0, byAction: {}, decisions: 0, overrides: 0 };
}
async function record(env, fn) {
  try {
    const k = "m:" + today();
    const cur = Object.assign(emptyDay(today()), JSON.parse((await env.KV.get(k)) || "null") || {});
    fn(cur);
    await env.KV.put(k, JSON.stringify(cur), { expirationTtl: 90 * 86400 });
  } catch (e) { /* monitoring never breaks a request */ }
}
function recordResult(m, r, freshSteps, batch) {
  m.notices++;
  if (r.route.steps[0] && r.route.steps[0].modelKey === "rules") m.rulesOnly++;
  if (r.route.escalated) m.escalations++;
  freshSteps.forEach(function (s) {
    m.modelCalls++; if (batch) m.batchCalls++;
    m.byModel[s.modelKey] = (m.byModel[s.modelKey] || 0) + 1;
    m.costUsd = Math.round((m.costUsd + (s.costUsd || 0)) * 1e6) / 1e6;
    m.cacheReadTokens += (s.usage && s.usage.cache_read_input_tokens) || 0;
    if (!batch) {
      m.latencyMs += s.latencyMs || 0;
      let b = LAT_BUCKETS.findIndex(function (x) { return (s.latencyMs || 0) < x; });
      m.latency[b < 0 ? LAT_BUCKETS.length : b]++;
    }
  });
  m.facts += r.facts.length; m.rejected += r.rejected.length; m.injections += r.injections.length;
  m.byAction[r.decision.act] = (m.byAction[r.decision.act] || 0) + 1;
}

async function handleMetrics(url, env) {
  if (!env.KV) return json({ error: "not_configured" }, 503);
  const n = Math.max(1, Math.min(30, parseInt(url.searchParams.get("days") || "14", 10) || 14));
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push(Object.assign(emptyDay(d), JSON.parse((await env.KV.get("m:" + d)) || "null") || {}));
  }
  return json({ days: days, latencyBuckets: LAT_BUCKETS, dailyLimit: parseInt(env.DAILY_LIMIT || "300", 10), prompt: PROMPT_VERSION, samples: SAMPLES_VERSION }, 200, { "cache-control": "public, max-age=30" });
}

async function handleFeedback(request, env) {
  if (!env.KV) return json({ error: "not_configured" }, 503);
  let b;
  try { b = await request.json(); } catch (_) { return json({ error: "bad_json", message: "The request is not valid JSON." }, 400); }
  if (!b || !ACTIONS[b.ai] || !ACTIONS[b.decision]) return json({ error: "bad_input", message: "ai and decision must be one of " + Object.keys(ACTIONS).join(", ") + "." }, 400);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await bump(env, "rl:fb:" + ip + ":" + today(), LIMITS.feedbackPerIpPerDay, 172800))) return json({ error: "rate_limited", message: "Too many decisions today." }, 429);
  await record(env, function (m) { m.decisions++; if (b.ai !== b.decision) m.overrides++; });
  return json({ ok: true });
}

// ---------- triage ----------
const RULES_STEP = { model: "rules", modelKey: "rules", v: { category: "protection_of_minors", categoryConfidence: 1, language: "", summary: "", facts: [], rejected: [] }, injections: [], costUsd: 0, latencyMs: 0, usage: null };

async function step(env, notice, modelKey, cacheKey, ttl, fresh) {
  if (cacheKey) {
    const hit = await env.KV.get(cacheKey);
    if (hit) return JSON.parse(hit);
  }
  const s = await runModel({ env: env, notice: notice, modelKey: modelKey });
  s.ranAt = new Date().toISOString();
  fresh.push(s);
  if (cacheKey) await env.KV.put(cacheKey, JSON.stringify(s), ttl ? { expirationTtl: ttl } : undefined);
  return s;
}

export async function triage(env, notice, policyStr, keyBase, ttl) {
  const policy = parsePolicy(policyStr) || parsePolicy(DEFAULT_POLICY);
  const label = policy.join(">");
  if (minorSafety(notice.text)) return { result: finish(notice, label, [RULES_STEP], { reasons: ["The notice may concern a minor: routed to the specialist team by rule, no model call"] }, today()), fresh: [], rules: true };
  const fresh = [];
  const key = function (m) { return keyBase ? keyBase + ":" + m : null; };
  const first = await step(env, notice, policy[0], key(policy[0]), ttl, fresh);
  if (policy.length === 1) return { result: finish(notice, label, [first], null, (first.ranAt || "").slice(0, 10) || today()), fresh: fresh };
  const route = routeDecision(notice, first.v, first.injections);
  if (!route.escalate) return { result: finish(notice, label, [first], route, (first.ranAt || "").slice(0, 10) || today()), fresh: fresh };
  const second = await step(env, notice, policy[1], key(policy[1]), ttl, fresh);
  return { result: finish(notice, label, [first, second], route, (second.ranAt || "").slice(0, 10) || today()), fresh: fresh };
}

async function overBudget(env) { return parseInt((await env.KV.get("rl:day:" + today())) || "0", 10) >= parseInt(env.DAILY_LIMIT || "400", 10); }
async function spend(env, n) { if (n) await env.KV.put("rl:day:" + today(), String(parseInt((await env.KV.get("rl:day:" + today())) || "0", 10) + n), { expirationTtl: 172800 }); }

// One model on one sample item. The evaluation calls this for every model and item; results are cached forever per version.
async function handleRun(request, env) {
  if (!env.KV) return json({ error: "not_configured" }, 503);
  let b;
  try { b = await request.json(); } catch (_) { return json({ error: "bad_json", message: "The request is not valid JSON." }, 400); }
  const item = ITEMS.find(function (x) { return x.id === (b && b.itemId); });
  if (!item) return json({ error: "unknown_item", message: "Unknown sample notice or attack." }, 404);
  if (!MODELS[b.model]) return json({ error: "unknown_model", message: "Unknown model." }, 400);
  const key = "x:s:" + SAMPLES_VERSION + ":" + PROMPT_VERSION + ":" + item.id + ":" + b.model;
  const hit = await env.KV.get(key);
  if (hit) { const s = JSON.parse(hit); return json({ itemId: item.id, model: b.model, cached: true, step: compact(s) }); }
  if (await overBudget(env)) return json({ error: "budget", message: "Today's model budget is used up." }, 429);
  const fresh = [];
  let s;
  try { s = await step(env, item, b.model, key, null, fresh); }
  catch (e) { await record(env, function (m) { m.errors++; }); return json({ error: "model_error", message: "The model call failed.", status: e.status || 0, upstream: e.detail || "" }, 502); }
  await spend(env, fresh.length);
  await record(env, function (m) { recordResult(m, finish(item, b.model, [s], null, today()), fresh, false); });
  return json({ itemId: item.id, model: b.model, cached: false, step: compact(s) });
}

// Tries each Workers AI candidate id with a tiny prompt and remembers the first that answers.
async function handleProbe(env) {
  if (!env.KV) return json({ error: "not_configured" }, 503);
  if (!env.AI) return json({ error: "no_ai_binding", message: "The Workers AI binding is not configured." }, 503);
  if (!(await bump(env, "rl:probe:" + today(), LIMITS.probesPerDay, 172800))) return json({ error: "rate_limited", message: "Up to " + LIMITS.probesPerDay + " probes a day." }, 429);
  const resolved = {}, errors = {};
  for (const k of Object.keys(MODELS)) {
    const m = MODELS[k];
    if (m.provider !== "workers-ai") continue;
    for (const id of m.ids) {
      try {
        const input = m.api === "responses" ? { instructions: "Answer with one word.", input: "Say OK." } : { messages: [{ role: "user", content: "Say OK." }], max_tokens: 5 };
        await env.AI.run(id, input);
        resolved[k] = id; break;
      } catch (e) { errors[k] = (errors[k] ? errors[k] + " | " : "") + id + ": " + String((e && e.message) || e).slice(0, 120); }
    }
  }
  await env.KV.put("models:resolved", JSON.stringify(resolved));
  return json({ resolved: resolved, errors: errors });
}

async function handleTriage(request, env) {
  if (!env.KV) return json({ error: "not_configured", message: "Storage is not configured." }, 503);
  if (parseInt(request.headers.get("content-length") || "0", 10) > 20000) return json({ error: "too_large", message: "The request is too large." }, 413);
  let b;
  try { b = await request.json(); } catch (_) { return json({ error: "bad_json", message: "The request is not valid JSON." }, 400); }
  if (!b || typeof b !== "object") return json({ error: "bad_input", message: "Nothing to triage." }, 400);
  if (b.policy != null && !parsePolicy(b.policy)) return json({ error: "unknown_policy", message: "A policy is one model key, or two joined by '>', such as llama-3.1-8b-fast>haiku. See /api/v1/models." }, 400);
  const strategy = b.policy || DEFAULT_POLICY;
  let notice, keyBase, ttl = null, own = false;
  if (b.noticeId) {
    notice = NOTICES.find(function (n) { return n.id === b.noticeId; });
    if (!notice) return json({ error: "unknown_notice", message: "Unknown sample notice." }, 404);
    keyBase = "x:s:" + SAMPLES_VERSION + ":" + PROMPT_VERSION + ":" + notice.id; // the same keys as /run, so the lab and the desk share answers
  } else {
    const n = b.notice || {};
    const body = clean(n.text, LIMITS.charsPerNotice + 1);
    if (!body.trim()) return json({ error: "empty", message: "Paste the text of a notice." }, 400);
    if (body.length > LIMITS.charsPerNotice) return json({ error: "too_long", message: "A notice can have up to " + LIMITS.charsPerNotice + " characters." }, 400);
    const from = clean(n.from, 200), subject = clean(n.subject, 200);
    notice = { id: "OWN", channel: "web form", text: "From: " + (from || "web form") + "\nSubject: " + (subject || "(no subject)") + "\n\n" + body, meta: { senderRecentCount: Math.max(0, Math.min(1000, parseInt(n.senderRecentCount || "1", 10) || 1)) } };
    keyBase = "x:o:" + PROMPT_VERSION + ":" + (await sha256(notice.text + "|" + notice.meta.senderRecentCount));
    ttl = 7 * 86400;
    own = true;
  }
  const firstModel = parsePolicy(strategy)[0];
  const day = today();
  if (own) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const seenKey = keyBase + ":" + firstModel;
    if (!(await env.KV.get(seenKey)) && !(await bump(env, "rl:ip:" + ip + ":" + day, LIMITS.perIpPerDay, 172800))) {
      await record(env, function (m) { m.limited++; });
      return json({ error: "rate_limited", message: "You have reached today's limit of " + LIMITS.perIpPerDay + " live runs. The sample notices still work." }, 429);
    }
  }
  if (!(await env.KV.get(keyBase + ":" + firstModel)) && (await overBudget(env))) {
    await record(env, function (m) { m.limited++; });
    return json({ error: "budget", message: "Today's live budget is used up. Cached sample results still work." }, 429);
  }
  let out;
  try { out = await triage(env, notice, strategy, keyBase, ttl); }
  catch (e) {
    await record(env, function (m) { m.errors++; });
    return json({ error: "model_error", message: "The model call failed. Please try again in a minute.", status: e.status || 0, upstream: e.detail || "" }, 502);
  }
  if (out.fresh.length || out.rules) {
    await spend(env, out.fresh.length);
    await record(env, function (m) { recordResult(m, out.result, out.fresh, false); });
  }
  out.result.cached = out.fresh.length === 0;
  out.result.freshCalls = out.fresh.length;
  return json(out.result);
}

// ---------- batches ----------
async function handleBatchCreate(request, env) {
  if (!env.KV) return json({ error: "not_configured" }, 503);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "live_off", message: "Live mode is switched off on this deployment." }, 503);
  let b = {};
  try { b = await request.json(); } catch (_) { b = {}; }
  const modelKey = b.model === "sonnet" ? "sonnet" : "haiku"; // batches are a Claude feature
  if (!(await bump(env, "rl:batch:" + today(), LIMITS.batchesPerDay, 172800))) return json({ error: "rate_limited", message: "Up to " + LIMITS.batchesPerDay + " batches a day." }, 429);
  const notices = NOTICES.filter(function (n) { return !minorSafety(n.text); });
  let batch;
  try { batch = await createBatch({ apiKey: env.ANTHROPIC_API_KEY, notices: notices, modelKey: modelKey }); }
  catch (e) { return json({ error: "model_error", message: "Creating the batch failed.", upstream: e.detail || "" }, 502); }
  const meta = { id: batch.id, modelKey: modelKey, requests: notices.length, createdAt: new Date().toISOString(), samples: SAMPLES_VERSION, prompt: PROMPT_VERSION };
  await env.KV.put("batch:" + batch.id, JSON.stringify(meta), { expirationTtl: 30 * 86400 });
  await env.KV.put("batch:last", JSON.stringify(meta), { expirationTtl: 30 * 86400 });
  return json({ id: batch.id, status: batch.processing_status, requests: notices.length, modelKey: modelKey });
}

async function handleBatchGet(id, env) {
  if (!env.KV) return json({ error: "not_configured" }, 503);
  const meta = JSON.parse((await env.KV.get("batch:" + id)) || "null");
  if (!meta) return json({ error: "unknown_batch", message: "Unknown batch." }, 404);
  const done = await env.KV.get("batchres:" + id);
  if (done) return json(JSON.parse(done));
  if (!env.ANTHROPIC_API_KEY) return json({ error: "live_off", message: "Live mode is switched off on this deployment." }, 503);
  let st;
  try { st = await getBatch({ apiKey: env.ANTHROPIC_API_KEY, id: id }); }
  catch (e) { return json({ error: "model_error", message: "Reading the batch failed.", upstream: e.detail || "" }, 502); }
  if (st.processing_status !== "ended") return json({ id: id, status: st.processing_status, counts: st.request_counts, modelKey: meta.modelKey });
  let lines;
  try { lines = await batchResults({ apiKey: env.ANTHROPIC_API_KEY, url: st.results_url }); }
  catch (e) { return json({ error: "model_error", message: "Reading the batch results failed.", upstream: e.detail || "" }, 502); }
  const results = [], failed = [];
  const createdMs = Date.parse(meta.createdAt), endedMs = Date.parse(st.ended_at || new Date().toISOString());
  lines.forEach(function (l) {
    const n = NOTICES.find(function (x) { return x.id.replace(/[^a-zA-Z0-9_-]/g, "_") === l.custom_id; });
    if (!n) return;
    if (!l.result || l.result.type !== "succeeded") { failed.push({ noticeId: n.id, type: l.result ? l.result.type : "unknown" }); return; }
    const s = readAnswer(n, meta.modelKey, l.result.message, null, true);
    results.push(finish(n, "batch-" + meta.modelKey, [s], null, (st.ended_at || "").slice(0, 10) || today()));
  });
  const out = { id: id, status: "ended", modelKey: meta.modelKey, counts: st.request_counts, createdAt: meta.createdAt, endedAt: st.ended_at, wallClockMs: endedMs - createdMs, results: results, failed: failed };
  await env.KV.put("batchres:" + id, JSON.stringify(out), { expirationTtl: 30 * 86400 });
  await record(env, function (m) { results.forEach(function (r) { recordResult(m, r, [{ modelKey: meta.modelKey, costUsd: r.costUsd, usage: r.usage[0] }], true); }); });
  return json(out);
}

function health(env) {
  return json({ ok: true, live: !!env.ANTHROPIC_API_KEY, workersAI: !!env.AI, version: "v2", defaultPolicy: DEFAULT_POLICY, models: Object.keys(MODELS),
    prompt: PROMPT_VERSION, samples: SAMPLES_VERSION, limits: LIMITS });
}
async function models(env) {
  const resolved = JSON.parse((await env.KV.get("models:resolved")) || "{}");
  return json({ models: Object.keys(MODELS).map(function (k) { const m = MODELS[k]; return { key: k, label: m.label, provider: m.provider, family: m.family, params: m.params, quant: m.quant, inPerM: m.inPerM, outPerM: m.outPerM, id: m.provider === "anthropic" ? m.ids[0] : resolved[k] || null }; }), probed: Object.keys(resolved).length > 0 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/^\/api\/v1\//, "/api/");
    if (p.startsWith("/api/") && env.KV && env.AI && !env.RESOLVED) { try { env.RESOLVED = JSON.parse((await env.KV.get("models:resolved")) || "{}"); } catch (e) { env.RESOLVED = {}; } }
    if (url.pathname === "/api/openapi.json") return json(openapi(url.origin), 200, { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });
    if (p === "/api/health") return health(env);
    if (p === "/api/models") return models(env);
    if (p === "/api/run") return request.method === "POST" ? handleRun(request, env) : json({ error: "method_not_allowed" }, 405);
    if (p === "/api/probe") return request.method === "POST" ? handleProbe(env) : json({ error: "method_not_allowed" }, 405);
    if (p === "/api/triage") return request.method === "POST" ? handleTriage(request, env) : json({ error: "method_not_allowed" }, 405);
    if (p === "/api/feedback") return request.method === "POST" ? handleFeedback(request, env) : json({ error: "method_not_allowed" }, 405);
    if (p === "/api/metrics") return request.method === "GET" ? handleMetrics(url, env) : json({ error: "method_not_allowed" }, 405);
    if (p === "/api/batch") {
      if (request.method === "POST") return handleBatchCreate(request, env);
      if (request.method === "GET") { const last = await env.KV.get("batch:last"); return json(last ? JSON.parse(last) : { id: null }); }
      return json({ error: "method_not_allowed" }, 405);
    }
    const bm = /^\/api\/batch\/([A-Za-z0-9_-]{1,100})$/.exec(p);
    if (bm) return request.method === "GET" ? handleBatchGet(bm[1], env) : json({ error: "method_not_allowed" }, 405);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
