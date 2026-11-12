// Writes the data the Python package needs, from the same modules the Worker and the page use:
// the 19 sample items with their reference labels, the model registry (prices) and the router constants.
// The rules themselves are ported to Python; tests in py/tests prove both implementations agree.
//   node eval/export-fixture.mjs            writes py/noticedesk_eval/fixture.json
//   node eval/export-fixture.mjs --stdout   prints it (the Python test compares it with the committed file)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ITEMS, SAMPLES_VERSION } from "../public/desk/samples.js";
import { MODELS, STRONG } from "../public/lib/models.js";
import { ROUTER, CATEGORY_LABELS, PLATFORM_HOST } from "../public/lib/core.js";
import { F1_TOLERANCE, COST_TOLERANCE } from "../public/lib/lab.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = {
  samplesVersion: SAMPLES_VERSION,
  items: ITEMS.map((it) => ({ id: it.id, attack: !!it.attack, text: it.text, meta: it.meta || {}, goal: it.goal || null,
    gold: { category: it.gold.category, act: it.gold.act, injection: !!it.gold.injection, facts: it.gold.facts } })),
  models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { label: m.label, provider: m.provider, inPerM: m.inPerM, outPerM: m.outPerM, retired: m.retired || null }])),
  strong: STRONG,
  router: ROUTER,
  categoryLabels: CATEGORY_LABELS,
  platformHost: PLATFORM_HOST,
  f1Tolerance: F1_TOLERANCE,
  costTolerance: COST_TOLERANCE,
};
const out = JSON.stringify(fixture, null, 1) + "\n";
if (process.argv.includes("--stdout")) process.stdout.write(out);
else { fs.writeFileSync(path.join(here, "../py/noticedesk_eval/fixture.json"), out); console.log("Wrote py/noticedesk_eval/fixture.json (" + fixture.items.length + " items, " + Object.keys(fixture.models).length + " models)"); }
