// The models in the lab. Shared by the Worker, the evaluation and the page.
// Workers AI ids are listed as candidates: the probe endpoint finds which ones this account can run,
// because the catalogue changes over time. Prices are list prices in USD per million tokens (October 2026)
// and are used only for cost estimates; Workers AI bills in Neurons at $0.011 per 1,000.

export const MODELS = {
  "llama-3.2-1b": { label: "Llama 3.2 1B", provider: "workers-ai", family: "Llama", params: "1B", quant: "fp16", ids: ["@cf/meta/llama-3.2-1b-instruct"], inPerM: 0.027, outPerM: 0.201, jsonMode: true, retired: "2026-11-20" },
  "llama-3.2-3b": { label: "Llama 3.2 3B", provider: "workers-ai", family: "Llama", params: "3B", quant: "fp16", ids: ["@cf/meta/llama-3.2-3b-instruct"], inPerM: 0.0509, outPerM: 0.335, jsonMode: true, retired: "2026-11-20" },
  "llama-3.1-8b": { label: "Llama 3.1 8B", provider: "workers-ai", family: "Llama", params: "8B", quant: "fp16", ids: ["@cf/meta/llama-3.1-8b-instruct"], inPerM: 0.282, outPerM: 0.827, jsonMode: true, variantOf: "llama-3.1-8b", retired: "2026-05-30" },
  "llama-3.1-8b-fp8": { label: "Llama 3.1 8B fp8", provider: "workers-ai", family: "Llama", params: "8B", quant: "fp8", ids: ["@cf/meta/llama-3.1-8b-instruct-fp8"], inPerM: 0.152, outPerM: 0.287, variantOf: "llama-3.1-8b", jsonMode: true, retired: "2026-11-20" },
  "llama-3.1-8b-awq": { label: "Llama 3.1 8B AWQ int4", provider: "workers-ai", family: "Llama", params: "8B", quant: "int4 (AWQ)", ids: ["@cf/meta/llama-3.1-8b-instruct-awq"], inPerM: 0.123, outPerM: 0.266, variantOf: "llama-3.1-8b", jsonMode: true, retired: "2026-05-30" },
  "llama-3.1-8b-fast": { label: "Llama 3.1 8B fp8-fast", provider: "workers-ai", family: "Llama", params: "8B", quant: "fp8, fast kernels", ids: ["@cf/meta/llama-3.1-8b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct-fast"], inPerM: 0.045, outPerM: 0.384, jsonMode: true, variantOf: "llama-3.1-8b" },
  "llama-3.3-70b": { label: "Llama 3.3 70B fp8-fast", provider: "workers-ai", family: "Llama", params: "70B", quant: "fp8", ids: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"], inPerM: 0.293, outPerM: 2.253, jsonMode: true },
  "gpt-oss-20b": { label: "gpt-oss 20B", provider: "workers-ai", family: "gpt-oss", params: "21B MoE (3.6B active)", quant: "MXFP4", ids: ["@cf/openai/gpt-oss-20b"], inPerM: 0.20, outPerM: 0.30, api: "responses" },
  haiku: { label: "Claude Haiku 5.5", provider: "anthropic", family: "Claude", params: "", quant: "", ids: ["claude-haiku-5-5"], inPerM: 0.10, outPerM: 0.50, forceTool: true, maxTokens: 3000 },
  sonnet: { label: "Claude Sonnet 5.5", provider: "anthropic", family: "Claude", params: "", quant: "", ids: ["claude-sonnet-5-5"], inPerM: 2.00, outPerM: 10.00, forceTool: false, maxTokens: 6000 },
};
export const MODEL_KEYS = Object.keys(MODELS);

// Workers AI retires models from its catalogue. A retired model keeps its recorded answers in the lab,
// but no fresh call is made from the retirement day on, and the live policy picker no longer offers it.
// `retired` is the first day the model is gone, from the provider's deprecation notice.
export function isRetired(key, day) {
  const r = MODELS[key] && MODELS[key].retired;
  return !!r && String(day || new Date().toISOString().slice(0, 10)) >= r;
}
// Retired or announced for retirement: the live picker leaves these out, so nobody starts on a model about to disappear.
export const hasRetirement = (key) => !!(MODELS[key] && MODELS[key].retired);
export const BATCH_DISCOUNT = 0.5;
export const QUANT_FAMILY = ["llama-3.1-8b", "llama-3.1-8b-fp8", "llama-3.1-8b-awq", "llama-3.1-8b-fast"];
export const STRONG = ["sonnet", "haiku", "llama-3.3-70b"]; // candidates for the second tier of a cascade

export function costUsd(modelKey, usage, batch) {
  const m = MODELS[modelKey];
  if (!m || !usage) return 0;
  const inTok = (usage.input_tokens || usage.prompt_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  const outTok = usage.output_tokens || usage.completion_tokens || 0;
  const c = (inTok * m.inPerM + outTok * m.outPerM) / 1e6;
  return batch ? c * BATCH_DISCOUNT : c;
}

// A policy is one model, or a cheap model whose result the router may hand to a stronger one.
export function parsePolicy(p) {
  const s = String(p || "");
  const m = /^([a-z0-9.-]+)(?:>([a-z0-9.-]+))?$/.exec(s);
  if (!m || !MODELS[m[1]] || (m[2] && (!MODELS[m[2]] || m[2] === m[1]))) return null;
  return m[2] ? [m[1], m[2]] : [m[1]];
}
export const policyLabel = (p) => (parsePolicy(p) || []).map((k) => MODELS[k].label).join(" → ");
