// OpenAPI 3.1 description of the public API, served at /api/openapi.json.
import { CATEGORIES, KINDS, ACTIONS } from "../public/lib/core.js";
import { MODEL_KEYS } from "../public/lib/models.js";

export function openapi(origin) {
  const error = { type: "object", properties: { error: { type: "string" }, message: { type: "string" }, upstream: { type: "string" } } };
  const policy = { type: "string", default: "haiku>sonnet", example: "llama-3.1-8b-fast>haiku",
    description: "One model key, or a cheap model and a strong one joined by '>'. The router sends a notice to the second model when a value fails verification, category confidence is below 75%, keywords contradict the model, the category is high-stakes, or rules and model disagree about an instruction. Keys: " + MODEL_KEYS.join(", ") + "." };
  const fact = { type: "object", properties: { id: { type: "string" }, kind: { type: "string", enum: KINDS }, value: { type: "string" }, quote: { type: "string" }, span: { type: "array", items: { type: "integer" } }, confidence: { type: "number" } } };
  const step = { type: "object", properties: { modelKey: { type: "string" }, model: { type: "string" }, category: { type: "string" }, categoryConfidence: { type: "number" }, facts: { type: "integer" }, rejected: { type: "integer" }, injections: { type: "integer" }, costUsd: { type: "number" }, latencyMs: { type: "integer" }, jsonError: { type: "boolean" }, format: { type: "string", enum: ["tool", "json_mode", "text_json", ""] } } };
  const result = { type: "object", properties: {
    noticeId: { type: "string" }, policy: { type: "string" }, promptVersion: { type: "string" },
    route: { type: "object", description: "Which models ran and why the second model was or was not called", properties: { escalated: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } }, steps: { type: "array", items: step } } },
    category: { type: "string", enum: CATEGORIES }, categoryConfidence: { type: "number" }, language: { type: "string" }, summary: { type: "string" },
    facts: { type: "array", items: fact }, rejected: { type: "array", items: { type: "object" } }, injections: { type: "array", items: { type: "object" } },
    decision: { type: "object", properties: { act: { type: "string", enum: Object.keys(ACTIONS) }, priority: { type: "string" }, slaHours: { type: "integer" }, why: { type: "string" }, missing: { type: "array", items: { type: "string" } } } },
    statement: { type: ["object", "null"], description: "Draft statement of reasons in the format of the EU DSA Transparency Database, for a moderator to approve" },
    costUsd: { type: "number" }, latencyMs: { type: "integer" }, cached: { type: "boolean" },
  } };
  const compact = { type: "object", description: "One model's answer reduced to what the router and the rules need: facts as [kind, value, quote], rejected values as [kind, value, reasons], injection sources",
    properties: { category: { type: "string" }, categoryConfidence: { type: "number" }, facts: { type: "array", items: { type: "array" } }, rejected: { type: "array", items: { type: "array" } }, inj: { type: "array", items: { type: "string" } }, jsonError: { type: "boolean" }, rawText: { type: "string" }, format: { type: "string" }, costUsd: { type: "number" }, latencyMs: { type: "integer" }, modelId: { type: "string" } } };
  const j = (schema) => ({ "application/json": { schema: schema } });
  return {
    openapi: "3.1.0",
    info: { title: "Notice Desk API", version: "2.0.0",
      description: "Triage of notices to a video platform under the EU Digital Services Act, with a choice of model policy. Ten models (open models on Workers AI and Claude) answer the same prompt; code verifies every quote, applies the rules and decides when a second model must look again. Fictional demo: do not send real personal data." },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/triage": { post: { summary: "Triage one notice through a policy",
        requestBody: { required: true, content: j({ oneOf: [
          { type: "object", required: ["noticeId"], properties: { noticeId: { type: "string", example: "N-2026-31407" }, policy: policy } },
          { type: "object", required: ["notice"], properties: { policy: policy, notice: { type: "object", required: ["text"], properties: { from: { type: "string" }, subject: { type: "string" }, text: { type: "string", maxLength: 5000 }, senderRecentCount: { type: "integer" } } } } },
        ] }) },
        responses: { 200: { description: "Triage result", content: j(result) }, 400: { description: "Invalid input", content: j(error) }, 429: { description: "Rate limit or daily budget", content: j(error) }, 502: { description: "Model call failed; not cached, safe to retry", content: j(error) } } } },
      "/api/v1/run": { post: { summary: "One model on one sample notice or attack; the evaluation's building block. Cached per item, model, prompt and sample version.",
        requestBody: { required: true, content: j({ type: "object", required: ["itemId", "model"], properties: { itemId: { type: "string", example: "A-2" }, model: { type: "string", enum: MODEL_KEYS } } }) },
        responses: { 200: { description: "The recorded answer", content: j({ type: "object", properties: { itemId: { type: "string" }, model: { type: "string" }, cached: { type: "boolean" }, step: compact } }) }, 404: { description: "Unknown item" }, 429: { description: "Daily budget" }, 502: { description: "Model call failed" } } } },
      "/api/v1/models": { get: { summary: "The model registry with list prices per million tokens and the Workers AI id that answered the last probe", responses: { 200: { description: "OK" } } } },
      "/api/v1/probe": { post: { summary: "Ask each Workers AI candidate id for one word and remember which ones this account can run. Up to 6 a day.", responses: { 200: { description: "resolved: model key → id; errors per key" }, 429: { description: "Probe limit" } } } },
      "/api/v1/batch": {
        post: { summary: "Queue all sample notices in one Claude Message Batch at 50% of the price", requestBody: { content: j({ type: "object", properties: { model: { type: "string", enum: ["haiku", "sonnet"] } } }) }, responses: { 200: { description: "Batch created" }, 429: { description: "Batch limit reached" } } },
        get: { summary: "The last batch", responses: { 200: { description: "Batch metadata" } } } },
      "/api/v1/batch/{id}": { get: { summary: "Batch status; validated results once it has ended", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Status or results" }, 404: { description: "Unknown batch" } } } },
      "/api/v1/feedback": { post: { summary: "Record a moderator's decision next to the proposal", requestBody: { required: true, content: j({ type: "object", required: ["ai", "decision"], properties: { ai: { type: "string", enum: Object.keys(ACTIONS) }, decision: { type: "string", enum: Object.keys(ACTIONS) } } }) }, responses: { 200: { description: "Recorded" } } } },
      "/api/v1/metrics": { get: { summary: "Daily counters, including calls per model", parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 30 } }], responses: { 200: { description: "OK" } } } },
      "/api/v1/health": { get: { summary: "Status, default policy, model keys, prompt and sample versions, limits", responses: { 200: { description: "OK" } } } },
    },
  };
}
