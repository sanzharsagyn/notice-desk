import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { buildRequest, textOf, parseJsonAnswer } from "../src/extract.js";
import { costUsd, MODELS, parsePolicy } from "../public/lib/models.js";
import { NOTICES } from "../public/desk/samples.js";
import { mockFetch, mockAIBinding, mockAI } from "./mock-model.mjs";

function kv() { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; }
function env(extra) { return Object.assign({ KV: kv(), AI: mockAIBinding(), ANTHROPIC_API_KEY: "test-key", DAILY_LIMIT: "300", ASSETS: { fetch: async () => new Response("asset") } }, extra || {}); }
let calls = [];
function useMock() {
  calls = [];
  const inner = mockFetch(async () => new Response("no network in tests", { status: 599 }));
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return inner(url, init); };
}
const post = (e, path, body, ip) => worker.fetch(new Request("https://x" + path, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip || "1.1.1.1" }, body: JSON.stringify(body) }), e);
const get = (e, path) => worker.fetch(new Request("https://x" + path), e);
const modelCalls = () => calls.filter((c) => c.url.endsWith("/v1/messages"));
// An AI binding that records every call and lets a test decide the answer.
function spyAI(answer) { const log = []; return { log, run: async (id, input) => { log.push({ id, input }); return answer(id, input, log.length); } }; }

test("request: tool schema, cached system prompt, the notice wrapped with its id", () => {
  const r = buildRequest(NOTICES[0], "haiku");
  assert.equal(r.model, "claude-haiku-5-5");
  assert.deepEqual(r.tool_choice, { type: "tool", name: "record_notice" });
  assert.deepEqual(r.system[0].cache_control, { type: "ephemeral" });
  assert.match(r.system[0].text, /untrusted input/);
  assert.match(r.messages[0].content, /<notice id="N-2026-31407" channel="email">/);
  assert.deepEqual(buildRequest(NOTICES[0], "sonnet").tool_choice, { type: "auto" });
});

test("cost: Claude standard and batch prices, Workers AI usage fields", () => {
  assert.equal(costUsd("haiku", { input_tokens: 1e6, output_tokens: 0 }), 0.10);
  assert.equal(costUsd("sonnet", { input_tokens: 0, output_tokens: 1e6 }, true), 5);
  assert.ok(Math.abs(costUsd("llama-3.1-8b-fast", { prompt_tokens: 1e6, completion_tokens: 1e6 }) - 0.429) < 1e-9);
  assert.equal(costUsd("llama-3.2-1b", null), 0);
});

test("policies: one model or cheap>strong, nothing else", () => {
  assert.deepEqual(parsePolicy("haiku"), ["haiku"]);
  assert.deepEqual(parsePolicy("llama-3.1-8b-fast>haiku"), ["llama-3.1-8b-fast", "haiku"]);
  assert.equal(parsePolicy("haiku>haiku"), null);
  assert.equal(parsePolicy("gpt-9"), null);
  assert.equal(parsePolicy("haiku>sonnet>sonnet"), null);
  assert.equal(Object.keys(MODELS).length, 10);
});

test("answers from open models: every shape the binding returns, JSON in prose or fences", () => {
  assert.equal(textOf({ response: "a" }), "a");
  assert.deepEqual(textOf({ response: { x: 1 } }), { x: 1 });
  assert.equal(textOf({ choices: [{ message: { content: "b" } }] }), "b");
  assert.equal(textOf({ output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "hmm" }] }, { type: "message", content: [{ type: "output_text", text: "c" }] }] }), "c");
  assert.deepEqual(parseJsonAnswer("Sure! ```json\n{\"category\": \"defamation\", \"facts\": [1,2,],}\n``` hope it helps"), { category: "defamation", facts: [1, 2] });
  assert.equal(parseJsonAnswer("no json here"), null);
});

test("default policy: a routine notice uses one cheap call, a high-stakes one adds the strong model", async () => {
  const e = env();
  useMock();
  const a = await (await post(e, "/api/v1/triage", { noticeId: "N-2026-31407" })).json();
  assert.equal(a.policy, "haiku>sonnet");
  assert.deepEqual(a.route.steps.map((s) => s.modelKey), ["haiku"]);
  assert.equal(a.decision.act, "remove");
  assert.equal(modelCalls().length, 1);
  const b = await (await post(e, "/api/v1/triage", { noticeId: "N-2026-31411" })).json();
  assert.deepEqual(b.route.steps.map((s) => s.modelKey), ["haiku", "sonnet"]);
  assert.equal(b.decision.act, "priority_review");
  assert.ok(b.costUsd > b.route.steps[0].costUsd);
  assert.equal(modelCalls().length, 3);
});

test("an open model first, Claude behind the router; an invalid policy is a 400", async () => {
  const e = env();
  useMock();
  const r = await (await post(e, "/api/v1/triage", { noticeId: "N-2026-31411", policy: "llama-3.1-8b-fast>haiku" })).json();
  assert.equal(r.route.steps[0].modelKey, "llama-3.1-8b-fast");
  assert.equal(r.route.steps[0].format, "json_mode");
  assert.equal(r.route.escalated, true);
  assert.ok(r.route.reasons.some((x) => /high-stakes/.test(x)));
  assert.equal(modelCalls().length, 1);
  const bad = await post(e, "/api/v1/triage", { noticeId: "N-2026-31411", policy: "gpt-9>haiku" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "unknown_policy");
});

test("answers are shared: the lab's /run and triage use the same cache, so comparing policies costs nothing extra", async () => {
  const e = env();
  useMock();
  const run = await (await post(e, "/api/v1/run", { itemId: "N-2026-31411", model: "haiku" })).json();
  assert.equal(run.cached, false);
  assert.equal(modelCalls().length, 1);
  const t = await (await post(e, "/api/v1/triage", { noticeId: "N-2026-31411", policy: "haiku" })).json();
  assert.equal(t.cached, true);
  assert.equal(modelCalls().length, 1);
  const again = await (await post(e, "/api/v1/run", { itemId: "N-2026-31411", model: "haiku" })).json();
  assert.equal(again.cached, true);
  assert.deepEqual(again.step, run.step);
  assert.equal((await post(e, "/api/v1/run", { itemId: "nope", model: "haiku" })).status, 404);
  assert.equal((await post(e, "/api/v1/run", { itemId: "A-1", model: "gpt-9" })).status, 400);
});

test("/run returns the compact answer the lab replays: facts with quotes, rejected values, who flagged the attack", async () => {
  const e = env();
  useMock();
  const r = await (await post(e, "/api/v1/run", { itemId: "A-1", model: "haiku" })).json();
  assert.equal(r.step.category, "intellectual_property");
  assert.ok(r.step.facts.every((f) => f.length === 3 && typeof f[2] === "string"));
  assert.deepEqual(r.step.inj, ["rule+model"], "the rule pattern and the model both reported the instruction");
  assert.equal(r.step.jsonError, false);
  assert.equal(r.step.format, "tool");
});

test("JSON mode not met: the plain prompt is tried, and broken JSON is recorded as a result, not an error", async () => {
  const ai = spyAI((id, input) => { if (input.response_format) throw new Error("JSON Mode couldn't be met"); return { response: "The notice is about copyright and the URL is above.", usage: { prompt_tokens: 2000, completion_tokens: 20 } }; });
  const e = env({ AI: ai });
  const res = await post(e, "/api/v1/run", { itemId: "N-2026-31407", model: "llama-3.1-8b-fast" });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(ai.log.length, 2);
  assert.ok(ai.log[0].input.response_format && !ai.log[1].input.response_format);
  assert.equal(r.step.jsonError, true);
  assert.equal(r.step.format, "text_json");
  assert.match(r.step.rawText, /copyright/);
  assert.deepEqual(r.step.facts, []);
  assert.ok(r.step.costUsd > 0);
  const again = await (await post(e, "/api/v1/run", { itemId: "N-2026-31407", model: "llama-3.1-8b-fast" })).json();
  assert.equal(again.cached, true);
  assert.equal(ai.log.length, 2);
});

test("gpt-oss is called through the Responses API shape", async () => {
  const ai = spyAI((id, input) => mockAI(id, input));
  const e = env({ AI: ai });
  const r = await (await post(e, "/api/v1/run", { itemId: "N-2026-31418", model: "gpt-oss-20b" })).json();
  assert.equal(ai.log[0].id, "@cf/openai/gpt-oss-20b");
  assert.ok(typeof ai.log[0].input.instructions === "string" && typeof ai.log[0].input.input === "string");
  assert.equal(r.step.category, "data_protection");
  assert.equal(r.step.jsonError, false);
});

test("probe: finds which candidate id this account can run and the next calls use it", async () => {
  const ai = spyAI((id, input) => {
    if (id === "@cf/meta/llama-3.1-8b-instruct-fp8-fast") throw new Error("5007: No such model");
    return mockAI(id === "@cf/meta/llama-3.1-8b-instruct-fast" ? "@cf/meta/llama-3.1-8b-instruct-fp8-fast" : id, input);
  });
  const e = env({ AI: ai });
  const p = await (await post(e, "/api/v1/probe", {})).json();
  assert.equal(p.resolved["llama-3.1-8b-fast"], "@cf/meta/llama-3.1-8b-instruct-fast");
  assert.match(p.errors["llama-3.1-8b-fast"], /No such model/);
  assert.equal(JSON.parse(e.KV.m.get("models:resolved"))["llama-3.1-8b-fast"], "@cf/meta/llama-3.1-8b-instruct-fast");
  assert.equal(Object.keys(p.resolved).length, 8);
  const m = await (await get(e, "/api/v1/models")).json();
  assert.equal(m.models.find((x) => x.key === "llama-3.1-8b-fast").id, "@cf/meta/llama-3.1-8b-instruct-fast");
  assert.equal(m.probed, true);
  ai.log.length = 0;
  const e2 = Object.assign({}, e, { RESOLVED: undefined });
  await post(e2, "/api/v1/run", { itemId: "N-2026-31407", model: "llama-3.1-8b-fast" });
  assert.equal(ai.log[0].id, "@cf/meta/llama-3.1-8b-instruct-fast");
});

test("a Workers AI failure (quota, unknown model) is a 502 and is not cached", async () => {
  const ai = spyAI(() => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); });
  const e = env({ AI: ai });
  const res = await post(e, "/api/v1/run", { itemId: "N-2026-31407", model: "llama-3.1-8b-fast" });
  assert.equal(res.status, 502);
  assert.match((await res.json()).upstream, /neurons/);
  assert.equal(ai.log.length, 1, "a quota error is not retried without JSON mode or with another id");
  assert.equal([...e.KV.m.keys()].filter((k) => k.startsWith("x:")).length, 0);
});

test("router escalates the notice the cheap model is unsure about", async () => {
  const e = env();
  useMock();
  const r = await (await post(e, "/api/v1/triage", { noticeId: "N-2026-31437" })).json();
  assert.equal(r.route.escalated, true);
  assert.match(r.route.reasons.join(), /confidence 55%/);
});

test("own notices: rules first, limits per IP, no model call for a minor-safety report", async () => {
  const e = env();
  useMock();
  const minor = await (await post(e, "/api/v1/triage", { notice: { text: "The person in https://demotube.example/v/aa is under 18." } })).json();
  assert.equal(minor.decision.act, "specialist");
  assert.equal(minor.route.steps[0].modelKey, "rules");
  assert.equal(modelCalls().length, 0);
  const mass = await (await post(e, "/api/v1/triage", { notice: { text: "Copyright: https://demotube.example/v/bb is mine.", senderRecentCount: 50 } })).json();
  assert.equal(mass.decision.act, "abuse_review");
  for (let i = 0; i < 5; i++) await post(e, "/api/v1/triage", { notice: { text: "Copyright notice number " + i + " https://demotube.example/v/c" + i } });
  assert.equal((await post(e, "/api/v1/triage", { notice: { text: "one too many https://demotube.example/v/zz" } })).status, 429);
  assert.equal((await post(e, "/api/v1/triage", { notice: { text: "another IP https://demotube.example/v/zz" } }, "2.2.2.2")).status, 200);
  assert.equal((await post(e, "/api/v1/triage", { notice: { text: "x".repeat(5001) } })).status, 400);
  assert.equal((await post(e, "/api/v1/triage", { notice: { text: "  " } })).status, 400);
  assert.equal((await post(e, "/api/v1/triage", { noticeId: "nope" })).status, 404);
});

test("daily budget: fresh calls stop at the cap, recorded answers are still served", async () => {
  const e = env({ DAILY_LIMIT: "2" });
  useMock();
  assert.equal((await post(e, "/api/v1/run", { itemId: "N-2026-31407", model: "haiku" })).status, 200);
  assert.equal((await post(e, "/api/v1/run", { itemId: "N-2026-31411", model: "haiku" })).status, 200);
  const over = await post(e, "/api/v1/run", { itemId: "N-2026-31415", model: "haiku" });
  assert.equal(over.status, 429);
  assert.equal((await over.json()).error, "budget");
  assert.equal((await (await post(e, "/api/v1/run", { itemId: "N-2026-31407", model: "haiku" })).json()).cached, true);
});

test("batch: queues the inbox, reports progress, then returns validated results at half price", async () => {
  const e = env();
  useMock();
  const b = await (await post(e, "/api/v1/batch", { model: "haiku" })).json();
  assert.equal(b.requests, 14);
  const created = JSON.parse(calls.find((c) => c.url.endsWith("/v1/messages/batches")).init.body);
  assert.equal(created.requests.length, 14);
  assert.match(created.requests[0].custom_id, /^[a-zA-Z0-9_-]{1,64}$/);
  const p1 = await (await get(e, "/api/v1/batch/" + b.id)).json();
  assert.equal(p1.status, "in_progress");
  const p2 = await (await get(e, "/api/v1/batch/" + b.id)).json();
  assert.equal(p2.status, "ended");
  assert.equal(p2.results.length, 14);
  const live = await (await post(e, "/api/v1/triage", { noticeId: "N-2026-31407", policy: "haiku" })).json();
  const batched = p2.results.find((r) => r.noticeId === "N-2026-31407");
  assert.ok(Math.abs(batched.costUsd - live.costUsd / 2) < 1e-9);
  assert.equal(batched.decision.act, "remove");
  const again = await (await get(e, "/api/v1/batch/" + b.id)).json();
  assert.equal(again.results.length, 14, "results are stored once the batch has ended");
  assert.equal((await get(e, "/api/v1/batch")).status, 200);
  await post(e, "/api/v1/batch", {}); await post(e, "/api/v1/batch", {});
  assert.equal((await post(e, "/api/v1/batch", {})).status, 429);
  assert.equal((await get(e, "/api/v1/batch/unknown")).status, 404);
});

test("metrics: notices, calls by model across providers, escalations and overrides", async () => {
  const e = env();
  useMock();
  await post(e, "/api/v1/triage", { noticeId: "N-2026-31407" });
  await post(e, "/api/v1/triage", { noticeId: "N-2026-31411" });
  await post(e, "/api/v1/triage", { noticeId: "N-2026-31407" }); // cached: not counted
  await post(e, "/api/v1/run", { itemId: "A-3", model: "llama-3.2-3b" });
  await post(e, "/api/v1/feedback", { ai: "remove", decision: "legal_review" });
  assert.equal((await post(e, "/api/v1/feedback", { ai: "remove", decision: "pay" })).status, 400);
  const d = (await (await get(e, "/api/v1/metrics?days=3")).json()).days[2];
  assert.equal(d.notices, 3);
  assert.equal(d.modelCalls, 4);
  assert.equal(d.byModel.haiku, 2);
  assert.equal(d.byModel.sonnet, 1);
  assert.equal(d.byModel["llama-3.2-3b"], 1);
  assert.equal(d.escalations, 1);
  assert.equal(d.overrides, 1);
});

test("Claude errors become a clean 502 with the upstream reason and are not cached", async () => {
  const e = env();
  globalThis.fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529 });
  const res = await post(e, "/api/v1/triage", { noticeId: "N-2026-31407" });
  assert.equal(res.status, 502);
  assert.match((await res.json()).upstream, /overloaded_error/);
  assert.equal([...e.KV.m.keys()].filter((k) => k.startsWith("x:")).length, 0);
});

test("routing: health, OpenAPI, 405 and 404", async () => {
  const e = env();
  const h = await (await get(e, "/api/v1/health")).json();
  assert.equal(h.live, true);
  assert.equal(h.workersAI, true);
  assert.equal(h.version, "v2");
  assert.equal(h.models.length, 10);
  const spec = await (await get(e, "/api/openapi.json")).json();
  assert.ok(spec.paths["/api/v1/run"] && spec.paths["/api/v1/probe"] && spec.paths["/api/v1/models"] && spec.paths["/api/v1/batch/{id}"]);
  assert.equal((await get(e, "/api/v1/triage")).status, 405);
  assert.equal((await get(e, "/api/v1/nothing")).status, 404);
  assert.equal(await (await get(e, "/")).text(), "asset");
});
