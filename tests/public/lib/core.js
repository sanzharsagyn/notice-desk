// Notice Desk: the deterministic core. Runs in the browser and in the Cloudflare Worker.
// No model is involved here: this file decides what counts as a verified fact, whether a notice
// is complete under Article 16 of the Digital Services Act, when to escalate to a stronger model,
// what action to propose, and how the statement of reasons is drafted.

export const PLATFORM_HOST = "demotube.example"; // the fictional platform
export const CATEGORIES = ["intellectual_property", "non_consensual", "data_protection", "impersonation", "defamation", "protection_of_minors", "not_specified"];
export const KINDS = ["url", "notifier_name", "notifier_email", "explanation", "good_faith", "work", "account", "trusted_flagger"];
export const PRESENCE_KINDS = ["explanation", "good_faith", "work", "trusted_flagger"];

export const CATEGORY_LABELS = {
  intellectual_property: "Copyright", non_consensual: "Published without consent", data_protection: "Personal data",
  impersonation: "Impersonation", defamation: "Defamation", protection_of_minors: "Protection of minors", not_specified: "No legal ground given",
};
export const KIND_LABELS = {
  url: "Location (URL)", notifier_name: "Notifier name", notifier_email: "Notifier email", explanation: "Why it is illegal",
  good_faith: "Good-faith statement", work: "Protected work identified", account: "Account", trusted_flagger: "Trusted flagger",
};
// Categories of the EU DSA Transparency Database (statement of reasons, field "category").
export const DSA_CATEGORY = {
  intellectual_property: "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
  non_consensual: "STATEMENT_CATEGORY_CYBER_VIOLENCE",
  data_protection: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  impersonation: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  defamation: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  protection_of_minors: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  not_specified: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
};
const LEGAL_GROUND = {
  intellectual_property: "Infringement of copyright and related rights (Directive 2001/29/EC as implemented in national law).",
  non_consensual: "Dissemination of a person's image without consent, unlawful under national law and Regulation (EU) 2016/679.",
  data_protection: "Unlawful publication of personal data, Regulation (EU) 2016/679 (GDPR).",
  impersonation: "Use of another person's identity and images without consent (identity misuse).",
};
export const EU_EEA = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK"];

export const ACTIONS = {
  specialist: { label: "Specialist team now", s: "crit", sla: 1, p: "P0" },
  abuse_review: { label: "Abuse review", s: "crit", sla: 24, p: "P1" },
  priority_review: { label: "Disable now, human confirms", s: "crit", sla: 24, p: "P1" },
  remove: { label: "Remove after approval", s: "ok", sla: 72, p: "P2" },
  legal_review: { label: "Legal review", s: "warn", sla: 120, p: "P2" },
  request_info: { label: "Ask the notifier for details", s: "warn", sla: 72, p: "P3" },
  dpo: { label: "Data protection officer", s: "warn", sla: 720, p: "P3" },
  reject: { label: "No action, inform notifier", s: "idle", sla: 120, p: "P3" },
};

// ---------- text helpers ----------
const WS = /[\s   ]+/g;
export function norm(s) {
  return String(s == null ? "" : s).normalize("NFC")
    .replace(/[‘’‚‛]/g, "'").replace(/[“”„‟«»]/g, '"')
    .replace(/[‐-―−]/g, "-").replace(WS, " ").trim();
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// Finds a quote in the original text, tolerant only of whitespace, quote-mark and dash differences.
export function findQuote(text, quote) {
  const q = norm(quote);
  if (q.length < 2) return null;
  const src = String(text).normalize("NFC");
  const parts = q.split(" ").map(function (w) {
    return escRe(w).replace(/'/g, "['‘’‚‛]").replace(/"/g, '["“”„‟«»]').replace(/-/g, "[-‐-―−]");
  });
  const m = new RegExp(parts.join("[\\s\\u00a0\\u2007\\u202f]+"), "u").exec(src);
  return m ? [m.index, m.index + m[0].length] : null;
}
export function normUrl(u) {
  try {
    const x = new URL(String(u).trim().replace(/[).,;\]]+$/, ""));
    if (!/^https?:$/.test(x.protocol)) return null;
    return x.protocol + "//" + x.host.toLowerCase() + x.pathname.replace(/\/+$/, "") + x.search;
  } catch (e) { return null; }
}
export const urlsIn = (text) => (String(text).match(/https?:\/\/[^\s<>"']+/g) || []).map(normUrl).filter(Boolean);
export const onPlatform = (u) => { try { return new URL(u).host === PLATFORM_HOST; } catch (e) { return false; } };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A quote can exist in the notice and still not mean what the model says. For the good-faith statement the meaning is
// checkable: it is a fixed legal formula. This list covers the languages of the sample set (added after prompt n3, when
// Llama 8B quoted "Bitte löscht das sofort." as a good-faith statement); production needs one per supported language.
const GOOD_FAITH_FORMULA = /good[ -]faith|bonne foi|buena fe|buona fede|w dobrej wierze|v dobré víře|in gutem glauben|guten glaubens|te goeder trouw|добросовісн|добросовестн/i;
export function meaningCheck(kind, quote) {
  if (kind === "good_faith" && !GOOD_FAITH_FORMULA.test(String(quote || ""))) return "quote is not a good-faith statement";
  return null;
}

// ---------- validation of the model's output ----------
// raw = { language, category, category_confidence, summary_en, facts:[{kind, value, quote, confidence}], instructions_found:[...] }
export function validateExtraction(notice, raw) {
  const text = notice.text, facts = [], rejected = [], seen = {};
  const list = raw && Array.isArray(raw.facts) ? raw.facts : [];
  list.forEach(function (f, i) {
    const why = [], kind = f && f.kind;
    let value = f && f.value != null ? String(f.value).trim() : "";
    if (KINDS.indexOf(kind) < 0) why.push("unknown field type");
    if (kind === "url") { value = normUrl(value) || ""; if (!value) why.push("not a valid URL"); else if (urlsIn(text).indexOf(value) < 0) why.push("URL does not appear in the notice"); }
    if (kind === "notifier_email") { value = value.toLowerCase(); if (!EMAIL.test(value)) why.push("not an email address"); else if (text.toLowerCase().indexOf(value) < 0) why.push("email does not appear in the notice"); }
    if ((kind === "notifier_name" || kind === "account") && value && !findQuote(text, value)) why.push("value does not appear in the notice");
    if (PRESENCE_KINDS.indexOf(kind) >= 0) {
      // A presence field is present or absent; the quote is the evidence. "no" means the model did not find it.
      if (/^(no|false|none|n\/?a|absent|not (stated|present|given))$/i.test(value)) return;
      value = "yes";
    }
    if (!value) why.push("empty value");
    const span = findQuote(text, f && f.quote);
    if (!span) why.push("quote not found in the notice");
    else { const m = meaningCheck(kind, f.quote); if (m) why.push(m); }
    let conf = Number(f && f.confidence);
    conf = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5;
    if (why.length) { rejected.push({ index: i, fact: f, reasons: why }); return; }
    const key = kind + "|" + value;
    if (seen[key]) return;
    seen[key] = true;
    facts.push({ id: "f" + (facts.length + 1), kind: kind, value: value, quote: text.slice(span[0], span[1]), span: span, confidence: conf });
  });
  let category = raw && CATEGORIES.indexOf(raw.category) >= 0 ? raw.category : null;
  let cconf = Number(raw && raw.category_confidence);
  cconf = Number.isFinite(cconf) ? Math.max(0, Math.min(1, cconf)) : 0;
  if (!category) { if (raw && raw.category) rejected.push({ index: -1, fact: { kind: "category", value: raw.category }, reasons: ["unknown category"] }); category = "not_specified"; cconf = 0; }
  const language = raw && /^[a-z]{2}$/i.test(String(raw.language || "")) ? String(raw.language).toLowerCase() : "";
  return { category: category, categoryConfidence: cconf, language: language, summary: String((raw && raw.summary_en) || "").slice(0, 600), facts: facts, rejected: rejected };
}

// ---------- rules that run before and around the model ----------
const MINOR = /\b(under\s?18|under-?age|a minor|minors|child(ren)?)\b|nezletil|minderjährig|\bmineur|menor de edad|minorenn|niepełnoletn|неповнолітн|несовершеннолетн/i;
// Reports concerning minors never go to a model in this demo: they go straight to trained specialists.
export function minorSafety(text) { return MINOR.test(String(text)); }

const HINTS = {
  intellectual_property: /copyright|urheberrecht|autorsk|praw\w* autorsk|droit d'auteur|derechos de autor|diritt\w* d'autore|licen[cs]/i,
  non_consensual: /consent|einwillig|consentement|souhlas|zgod[ay]|consentimiento|consenso|deepfake|згод/i,
  data_protection: /gdpr|dsgvo|rgpd|osobn\w* údaj|personal data|personenbezogen|données personnelles|dane osobowe|персональн/i,
  impersonation: /impersonat|pretend\w* to be|fake profile|perfil falso|haciéndose pasar|vydává za|usurpation/i,
  defamation: /defam|pomluv|pomlouv|diffam|verleumd|difamac|наклеп/i,
};
// A keyword hint, only when exactly one category matches. Used to catch a model that misreads the notice.
export function categoryHint(text) {
  const hits = Object.keys(HINTS).filter(function (k) { return HINTS[k].test(text); });
  return hits.length === 1 ? hits[0] : null;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)/i,
  /\b(system|admin|developer)\s+(note|prompt|message|instruction)/i,
  /\b(ai|llm|model|assistant|automated?\s+(system|review|processing))\b[^.\n]{0,80}\b(approve|remove|accept|ignore|override|classify|trust)/i,
  /without\s+(any\s+)?human\s+review/i,
  /(sistema automatico|système automatique|automatisch\w* system|automatick\w* systém)[^.\n]{0,120}/i,
  /senza revisione umana|sans (aucune )?revue humaine|ohne menschliche prüfung|bez lidské kontroly/i,
];
export function screenInjections(notice, modelFound) {
  const hits = [], text = String(notice.text || "");
  let pos = 0;
  text.split(/\n/).forEach(function (line) {
    const t = line.trim();
    if (t && INJECTION_PATTERNS.some(function (re) { return re.test(line); })) {
      const s = pos + line.indexOf(t);
      hits.push({ quote: t, span: [s, s + t.length], source: "rule" });
    }
    pos += line.length + 1;
  });
  (Array.isArray(modelFound) ? modelFound : []).forEach(function (m) {
    const span = findQuote(text, m && m.quote);
    if (!span) return;
    const same = hits.find(function (h) { return h.span[0] <= span[1] && span[0] <= h.span[1]; });
    if (same) { same.source = "rule+model"; if (m.why) same.why = String(m.why).slice(0, 200); }
    else hits.push({ quote: text.slice(span[0], span[1]), span: span, source: "model", why: m.why ? String(m.why).slice(0, 200) : "" });
  });
  return hits;
}

// ---------- routing between models ----------
export const ROUTER = { minConfidence: 0.75, highStakes: ["non_consensual", "defamation"] };
// Given the cheap model's validated result, decide whether the strong model must look again.
export function routeDecision(notice, v, injections) {
  const reasons = [];
  if (v.rejected.length) reasons.push(v.rejected.length + (v.rejected.length === 1 ? " fact failed" : " facts failed") + " verification");
  if (v.categoryConfidence < ROUTER.minConfidence) reasons.push("category confidence " + Math.round(v.categoryConfidence * 100) + "% is below " + Math.round(ROUTER.minConfidence * 100) + "%");
  const hint = categoryHint(notice.text);
  if (hint && hint !== v.category) reasons.push("keywords suggest " + CATEGORY_LABELS[hint] + ", the model said " + CATEGORY_LABELS[v.category]);
  if (ROUTER.highStakes.indexOf(v.category) >= 0) reasons.push(CATEGORY_LABELS[v.category] + " is a high-stakes category");
  const rule = injections.some(function (x) { return x.source !== "model"; }), model = injections.some(function (x) { return x.source !== "rule"; });
  if (rule !== model) reasons.push("rules and model disagree about a hidden instruction");
  return { escalate: reasons.length > 0, reasons: reasons };
}

// ---------- Article 16 and the proposed action ----------
const by = (facts, k) => facts.filter(function (f) { return f.kind === k; });
export function art16(category, facts) {
  const urls = by(facts, "url").map(function (f) { return f.value; });
  const req = [
    ["url", "Exact location of the content (URL)", urls.length > 0],
    ["explanation", "Why the content is illegal", by(facts, "explanation").length > 0],
    ["notifier_name", "Name of the notifier", by(facts, "notifier_name").length > 0],
    ["notifier_email", "Email of the notifier", by(facts, "notifier_email").length > 0],
    ["good_faith", "Statement of good faith", by(facts, "good_faith").length > 0],
  ];
  if (category === "intellectual_property") req.push(["work", "Which protected work is infringed", by(facts, "work").length > 0]);
  return req.map(function (r) { return { key: r[0], t: r[1], ok: r[2], ev: by(facts, r[0]).map(function (f) { return f.id; }) }; });
}

// notice = { id, text, meta:{ senderRecentCount, contentDate, received } }, v = validated extraction
export function decide(notice, v, injections) {
  const facts = v.facts, meta = notice.meta || {}, checks = art16(v.category, facts);
  const urls = by(facts, "url").map(function (f) { return f.value; }), platformUrls = urls.filter(onPlatform);
  const missing = checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.t; });
  const trusted = by(facts, "trusted_flagger").length > 0;
  let act, why;
  if (minorSafety(notice.text)) { act = "specialist"; why = "The notice may concern a minor. It goes to the specialist team at once and is never handled by a model."; }
  else if (injections.length) { act = "abuse_review"; why = "The notice contains text that tries to instruct the system. It is reported and checked by a person for misuse of the notice process (DSA Article 23)."; }
  else if ((meta.senderRecentCount || 0) > 20) { act = "abuse_review"; why = "This sender filed " + meta.senderRecentCount + " notices in the last 24 hours. Possible misuse of the notice process (DSA Article 23)."; }
  else if (v.category === "data_protection" && !platformUrls.length && by(facts, "account").length) { act = "dpo"; why = "A data subject request about an account, not about a piece of content. The data protection officer must answer within one month (GDPR Article 12(3))."; }
  else if (urls.length && !platformUrls.length) { act = "reject"; why = "None of the reported URLs is on " + PLATFORM_HOST + ". There is nothing to act on; the notifier is told so."; }
  else if (v.category === "not_specified") { act = "reject"; why = "The notice gives no legal ground. The content is checked against the terms of service and the notifier is told the outcome."; }
  else if (v.category === "non_consensual") { act = "priority_review"; why = "A person says the content was published without their consent. Access is disabled at once and a trained moderator confirms within 24 hours. Missing formalities are not a reason to wait."; }
  else if (v.category === "defamation") { act = "legal_review"; why = "Whether a statement is defamatory is a legal judgement. The legal team decides."; }
  else if (missing.length) { act = "request_info"; why = "The notice is incomplete under DSA Article 16: " + missing.join(", ").toLowerCase() + ". The notifier is asked to complete it."; }
  else { act = "remove"; why = "The notice is complete and substantiated. A moderator approves the removal and the statement of reasons is sent." + (trusted ? " Trusted flagger: priority processing (DSA Article 22)." : ""); }
  const a = ACTIONS[act];
  return { act: act, label: a.label, s: a.s, priority: trusted && act === "remove" ? "P1" : a.p, slaHours: trusted && act === "remove" ? 24 : a.sla, why: why, checks: checks, missing: missing, trusted: trusted, urls: urls, platformUrls: platformUrls };
}

// ---------- statement of reasons (DSA Article 17), in the Transparency Database format ----------
export function statementOfReasons(notice, v, d, opts) {
  if (["remove", "priority_review"].indexOf(d.act) < 0 || !d.platformUrls.length) return null;
  const url = d.platformUrls[0], path = new URL(url).pathname, account = /^\/(u|c)\//.test(path);
  const synthetic = /deepfake|ai-generated|generated by ai|umělou inteligencí|\bki-generiert/i.test(notice.text);
  const textOnly = /description|popis|beschreibung|опис/i.test(notice.text) && v.category === "data_protection";
  const sor = {
    decision_ground: "DECISION_GROUND_ILLEGAL_CONTENT",
    illegal_content_legal_ground: LEGAL_GROUND[v.category] || "Illegal content under applicable law.",
    illegal_content_explanation: (v.summary || "Notice under DSA Article 16.").slice(0, 2000),
    category: DSA_CATEGORY[v.category],
    content_type: [synthetic ? "CONTENT_TYPE_SYNTHETIC_MEDIA" : textOnly ? "CONTENT_TYPE_TEXT" : "CONTENT_TYPE_VIDEO"],
    automated_detection: "No",
    automated_decision: "AUTOMATED_DECISION_PARTIALLY",
    source_type: d.trusted ? "SOURCE_TRUSTED_FLAGGER" : "SOURCE_ARTICLE_16",
    application_date: (opts && opts.today) || new Date().toISOString().slice(0, 10),
    content_date: (notice.meta && notice.meta.contentDate) || (opts && opts.today) || new Date().toISOString().slice(0, 10),
    puid: (path.split("/").filter(Boolean).pop() || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 500),
    territorial_scope: EU_EEA.slice(),
    decision_facts: ("Notice " + notice.id + " received through the notice form. A language model extracted the reported location and the notifier's statements; every extracted value was checked against the notice text; a moderator reviewed the notice and approved the decision. Reported location: " + url + ".").slice(0, 5000),
  };
  if (account) sor.decision_account = "DECISION_ACCOUNT_SUSPENDED";
  else sor.decision_visibility = [d.act === "priority_review" ? "DECISION_VISIBILITY_CONTENT_DISABLED" : "DECISION_VISIBILITY_CONTENT_REMOVED"];
  if (d.trusted && v.category !== "non_consensual") { const n = by(v.facts, "notifier_name")[0]; if (n) sor.source_identity = n.value.slice(0, 500); }
  if (v.language) sor.content_language = v.language.toUpperCase();
  return sor;
}

// Checks a statement of reasons against the Transparency Database rules this demo relies on.
export function checkStatement(s) {
  const errs = [];
  if (!s) return ["missing"];
  if (["DECISION_GROUND_ILLEGAL_CONTENT", "DECISION_GROUND_INCOMPATIBLE_CONTENT"].indexOf(s.decision_ground) < 0) errs.push("decision_ground");
  if (!s.decision_visibility && !s.decision_account) errs.push("a decision field is required");
  if (Object.values(DSA_CATEGORY).indexOf(s.category) < 0) errs.push("category");
  if (s.decision_ground === "DECISION_GROUND_ILLEGAL_CONTENT" && (!s.illegal_content_legal_ground || s.illegal_content_legal_ground.length > 500)) errs.push("illegal_content_legal_ground");
  if (s.decision_ground === "DECISION_GROUND_ILLEGAL_CONTENT" && (!s.illegal_content_explanation || s.illegal_content_explanation.length > 2000)) errs.push("illegal_content_explanation");
  if (!/^[a-zA-Z0-9_-]{1,500}$/.test(s.puid || "")) errs.push("puid");
  ["application_date", "content_date"].forEach(function (k) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s[k] || "")) errs.push(k); });
  if (!Array.isArray(s.territorial_scope) || s.territorial_scope.some(function (c) { return EU_EEA.indexOf(c) < 0; })) errs.push("territorial_scope");
  if (["Yes", "No"].indexOf(s.automated_detection) < 0) errs.push("automated_detection");
  if (["AUTOMATED_DECISION_FULLY", "AUTOMATED_DECISION_PARTIALLY", "AUTOMATED_DECISION_NOT_AUTOMATED"].indexOf(s.automated_decision) < 0) errs.push("automated_decision");
  if (["SOURCE_ARTICLE_16", "SOURCE_TRUSTED_FLAGGER", "SOURCE_TYPE_OTHER_NOTIFICATION", "SOURCE_VOLUNTARY"].indexOf(s.source_type) < 0) errs.push("source_type");
  if (!s.decision_facts || s.decision_facts.length > 5000) errs.push("decision_facts");
  return errs;
}

export function fmtHours(h) { return h >= 48 ? Math.round(h / 24) + " days" : h + " h"; }
