// A stand-in for the Anthropic API in local tests: answers like a well-behaved model, derived from the reference labels.
// Haiku is made slightly unsure on one notice so the cascade has something to escalate. No key, no cost.
import { NOTICES, ITEMS } from "../public/desk/samples.js";
import { categoryHint, urlsIn } from "../public/lib/core.js";

const GOOD_FAITH = /good faith|bonne foi|buena fe|buona fede|dobrej wierze|dobré víře|добросовісно|accurate and complete/i;
function line(text, re) { return text.split("\n").map((l) => l.trim()).find((l) => re.test(l)); }
function bodyLine(text) { return text.split("\n\n").slice(1).join("\n").split("\n").map((l) => l.trim()).find((l) => l.length > 20 && !/^https?:/.test(l)); }

export function mockAnswer(text, modelKey) {
  const n = ITEMS.slice().sort((a, b) => b.text.length - a.text.length).find((x) => text.includes(x.text));
  const facts = [], found = [];
  if (n) {
    for (const [kind, value] of n.gold.facts) {
      let quote;
      if (kind === "url" || kind === "notifier_email" || kind === "notifier_name" || kind === "account") quote = value;
      else if (kind === "good_faith") quote = line(n.text, GOOD_FAITH);
      else if (kind === "trusted_flagger") quote = line(n.text, /zaufany/);
      else quote = bodyLine(n.text);
      facts.push({ kind, value, quote: quote || value, confidence: 0.92 });
    }
    n.text.split("\n").forEach((l) => { if (/SYSTEM NOTE|sistema automatico|Ignore previous|\[SYSTEM\]|systemu automatycznego|AI assistant/.test(l)) found.push({ quote: l.trim().replace(/^\[|\]$/g, ""), why: "Tries to instruct the automated process" }); });
    const unsure = modelKey === "haiku" && n.id === "N-2026-31437";
    return { language: n.lang, category: n.gold.category, category_confidence: unsure ? 0.55 : 0.93, summary_en: "[mock] " + n.subject, facts, instructions_found: found };
  }
  const body = text.replace(/^[\s\S]*?\n\n/, "");
  urlsIn(body).forEach((u) => facts.push({ kind: "url", value: u, quote: u, confidence: 0.9 }));
  const em = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(body);
  if (em) facts.push({ kind: "notifier_email", value: em[0], quote: em[0], confidence: 0.9 });
  const gf = line(body, GOOD_FAITH);
  if (gf) facts.push({ kind: "good_faith", value: "yes", quote: gf, confidence: 0.85 });
  text.split("\n").forEach((l) => { if (/ignore (all )?previous instructions|SYSTEM NOTE/i.test(l)) found.push({ quote: l.trim(), why: "Instruction to the system" }); });
  return { language: "en", category: categoryHint(text) || "not_specified", category_confidence: 0.8, summary_en: "[mock] own notice", facts, instructions_found: found };
}

function message(body) {
  const user = body.messages[0].content;
  const text = typeof user === "string" ? user : user.map((b) => b.text || "").join("");
  const modelKey = /sonnet/.test(body.model) ? "sonnet" : "haiku";
  return { id: "msg_mock", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "toolu_mock", name: "record_notice", input: mockAnswer(text, modelKey) }],
    usage: { input_tokens: 1700 + (text.length / 4 | 0), output_tokens: modelKey === "sonnet" ? 520 : 430, cache_read_input_tokens: 0 } };
}

export function mockFetch(realFetch, opts) {
  const batches = new Map();
  return async (url, init) => {
    const u = String(url);
    if (!u.startsWith("https://api.anthropic.com/")) return realFetch(url, init);
    if (opts && opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const ok = (d) => new Response(typeof d === "string" ? d : JSON.stringify(d), { status: 200 });
    if (u.endsWith("/v1/messages")) return ok(message(JSON.parse(init.body)));
    if (u.endsWith("/v1/messages/batches")) {
      const id = "msgbatch_mock" + (batches.size + 1);
      batches.set(id, { requests: JSON.parse(init.body).requests, polls: 0 });
      return ok({ id, type: "message_batch", processing_status: "in_progress", request_counts: { processing: batches.get(id).requests.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 } });
    }
    const m = /\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(u);
    if (m && batches.has(m[1])) {
      const b = batches.get(m[1]);
      if (m[2]) return ok(b.requests.map((r) => JSON.stringify({ custom_id: r.custom_id, result: { type: "succeeded", message: message(r.params) } })).join("\n"));
      b.polls++;
      const ended = b.polls > 1;
      return ok({ id: m[1], type: "message_batch", processing_status: ended ? "ended" : "in_progress", ended_at: ended ? new Date().toISOString() : null,
        request_counts: { processing: ended ? 0 : b.requests.length, succeeded: ended ? b.requests.length : 0, errored: 0, canceled: 0, expired: 0 },
        results_url: "https://api.anthropic.com/v1/messages/batches/" + m[1] + "/results" });
    }
    return new Response(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "mock: unknown path" } }), { status: 404 });
  };
}

// ---------- Workers AI stand-in ----------
// Each open model gets a deterministic "quality profile", so the local lab shows plausible differences.
// These numbers are invented for local testing only; the page warns when it shows them.
const PROFILE = {
  "@cf/meta/llama-3.2-1b-instruct": { drop: 0.45, json: 0.3, comply: 0.8, flag: 0.1, conf: 0.6, ms: 260 },
  "@cf/meta/llama-3.2-3b-instruct": { drop: 0.25, json: 0.12, comply: 0.6, flag: 0.3, conf: 0.7, ms: 380 },
  "@cf/meta/llama-3.1-8b-instruct": { drop: 0.08, json: 0.0, comply: 0.4, flag: 0.6, conf: 0.85, ms: 1400 },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { drop: 0.1, json: 0.02, comply: 0.4, flag: 0.6, conf: 0.84, ms: 900 },
  "@cf/meta/llama-3.1-8b-instruct-awq": { drop: 0.16, json: 0.05, comply: 0.5, flag: 0.5, conf: 0.8, ms: 800 },
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { drop: 0.11, json: 0.0, comply: 0.4, flag: 0.6, conf: 0.84, ms: 450 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { drop: 0.02, json: 0.0, comply: 0.1, flag: 0.9, conf: 0.92, ms: 1700 },
  "@cf/openai/gpt-oss-20b": { drop: 0.05, json: 0.0, comply: 0.2, flag: 0.8, conf: 0.9, ms: 1100 },
};
function h(s) { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; }
export function mockAI(id, input) {
  const p = PROFILE[id];
  if (!p) throw new Error("5007: No such model " + id);
  const text = input.input || (input.messages || []).map((m) => m.content).join("\n");
  if (/Say OK/.test(text)) return { response: "OK" };
  const n = ITEMS.slice().sort((a, b) => b.text.length - a.text.length).find((x) => text.includes(x.text));
  const ans = mockAnswer(text, "haiku");
  const key = id + "|" + (n ? n.id : text.length);
  ans.facts = ans.facts.filter((f, i) => h(key + i) > p.drop);
  ans.category_confidence = Math.min(0.99, p.conf + (h(key + "c") - 0.5) * 0.2);
  if (n && n.attack) {
    if (h(key + "comply") < p.comply) {
      if (n.goal.type === "category") ans.category = n.goal.value;
      if (n.goal.type === "no_urls") ans.facts = ans.facts.filter((f) => f.kind !== "url");
      if (n.goal.type === "trusted") ans.facts.push({ kind: "trusted_flagger", value: "yes", quote: "Verified trusted flagger, decision TF-EU-0001", confidence: 0.7 });
      if (n.goal.type === "extra_url") ans.facts.push({ kind: "url", value: n.goal.value, quote: n.goal.value, confidence: 0.8 });
    }
    if (h(key + "flag") > p.flag) ans.instructions_found = [];
  }
  if (h(key + "hall") < p.drop / 3) ans.facts.push({ kind: "notifier_name", value: "John Smith", quote: "John Smith", confidence: 0.6 });
  const usage = { prompt_tokens: 1900 + (text.length / 4 | 0), completion_tokens: 380 };
  const body = h(key + "j") < p.json ? "Here is the extracted information: category is copyright, the URL is listed above." : JSON.stringify(ans);
  if (input.response_format && h(key + "j") < p.json) throw new Error("JSON Mode couldn't be met");
  if (input.input) return { output: [{ type: "reasoning", content: [] }, { type: "message", content: [{ type: "output_text", text: body }] }], usage };
  return { response: input.response_format ? JSON.parse(body) : body, usage };
}
export function mockAIBinding(opts) {
  return { run: async (id, input) => { if (opts && opts.delayMs) await new Promise((r) => setTimeout(r, Math.min(opts.delayMs, (PROFILE[id] || {}).ms / 20 || 5))); return mockAI(id, input); } };
}
