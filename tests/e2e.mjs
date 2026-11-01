// Browser test of the lab against the local dev server.
//   node tests/dev-server.mjs &                                   mock models
//   node eval/run.mjs http://localhost:8790 --publish-local       writes public/desk/eval-results.json from the mock
//   node tests/e2e.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); }
const U = process.env.URL || "http://localhost:8790";
const b = await chromium.launch();
let ok = 0, bad = 0; const t = (n, c, x) => { c ? ok++ : bad++; console.log((c ? "OK  " : "FAIL") + " " + n + (!c && x !== undefined ? " -> " + JSON.stringify(x) : "")); };
const errs = [];
async function page(opts) {
  const p = await b.newPage(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  return p;
}
const noH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const ready = (p) => p.waitForFunction(() => document.querySelectorAll("#chart svg .pt").length > 0 && document.querySelectorAll("#board tbody tr").length > 0, null, { timeout: 15000 });

let p = await page();
await p.goto(U + "/");
await ready(p);
const res = await (await fetch(U + "/desk/eval-results.json")).json();
const nModels = Object.keys(res.models).length;
t("status pill shows both providers", /Workers AI.*Claude/.test(await p.textContent("#liveText")));
t("four KPIs", (await p.$$("#kpis .kpi")).length === 4);
t("mock warning shown for local results", await p.isVisible("#mockWarn"));
t("one leaderboard row per model", (await p.$$("#board tbody tr")).length === nModels, nModels);
const nPts = (await p.$$("#chart svg .pt")).length;
t("every policy is a point", nPts > nModels && nPts === (await p.$$("#policyTable tbody tr")).length, nPts);
t("recommended point ringed", (await p.$$("#chart svg .pt.rec")).length === 1);
t("frontier line drawn", (await p.$$("#chart svg polyline.front")).length === 1);
t("recommendation names a policy", (await p.textContent("#recBody")).length > 40);
t("escalation reasons listed", (await p.$$("#reasons li")).length === 5);
t("four quantization variants plus a reading", (await p.$$("#quantGrid .qm")).length === 5);
t("attack matrix: five attacks", (await p.$$("#attackMatrix tbody tr")).length === 5);
t("attack matrix: a column per model", (await p.$$("#attackMatrix thead tr:last-child th.m")).length === nModels + 2);

// interactions
const before = await p.getAttribute("#chart svg .pt.rec", "cy");
await p.click('#yseg button[data-y="atk"]');
t("switching the measure redraws the chart", (await p.getAttribute("#chart svg .pt.rec", "cy")) !== before);
t("segmented control state", (await p.getAttribute('#yseg button[data-y="atk"]', "aria-pressed")) === "true");
const pt = await p.$("#chart svg .pt.rec");
const bx = await pt.boundingBox();
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
t("hover shows a tooltip with cost", (await p.isVisible("#tip")) && /per 1,000/.test(await p.textContent("#tip")));
const first = await p.textContent("#board tbody tr:first-child td:first-child b");
await p.click('#board th[data-sort="cost"]');
const cheapest = await p.textContent("#board tbody tr:first-child td:first-child b");
t("sorting the leaderboard by cost", cheapest !== first || nModels === 1, [first, cheapest]);
await p.selectOption("#pick", "A-2");
t("inspector: attack text with the injected line marked", /nie zgłaszaj/.test(await p.textContent("#nText mark")));
t("inspector: router column plus one per model", (await p.$$("#cols .col")).length === nModels + 1);
t("inspector: complied or refused per model", (await p.$$("#cols .col b.bad, #cols .col b.good")).length >= nModels * 3);
await p.selectOption("#pick", "N-2026-31430");
t("inspector: verified facts as chips", (await p.$$("#cols .chip.g")).length >= 5);

// try your own notice
const opts = await p.$$eval("#ownPolicy option", (o) => o.map((x) => x.value));
t("policy picker offers the recommended policy first", opts[0] === res.recommended, opts);
await p.click('[data-ex="inject"]');
await p.selectOption("#ownPolicy", opts.includes("llama-3.1-8b-fast>haiku") ? "llama-3.1-8b-fast>haiku" : opts[0]);
await p.click("#ownRun");
await p.waitForFunction(() => document.querySelector("#ownOut .trace"), null, { timeout: 15000 });
t("own notice: hidden instruction goes to abuse review", /Abuse review/.test(await p.textContent("#ownOut")));
t("own notice: cost and time shown", /\$/.test(await p.textContent("#ownMsg")));
t("no horizontal scroll on desktop", await noH(p));
await p.close();

for (const scheme of ["light", "dark"]) {
  p = await page({ viewport: { width: 400, height: 860 }, colorScheme: scheme });
  await p.goto(U + "/");
  await ready(p);
  t("phone (" + scheme + "): no horizontal scroll", await noH(p));
  await p.close();
}

p = await page();
await p.goto(U + "/desk/api.html");
await p.selectOption("#model", "llama-3.2-1b");
await p.click("#run");
await p.waitForFunction(() => /HTTP 200/.test(document.getElementById("runMsg").textContent), null, { timeout: 15000 });
t("API page: /run request works", /"itemId": "A-2"/.test(await p.textContent("#out")));
t("API page: curl follows the pickers", /llama-3.2-1b/.test(await p.textContent("#curl1")));
await p.goto(U + "/desk/ops.html");
await p.waitForFunction(() => document.querySelectorAll("#tiles .tile").length >= 9, null, { timeout: 15000 });
t("monitoring: tiles count calls by provider", /Workers AI/.test(await p.textContent("#tiles")));
t("monitoring: seven checks", (await p.$$("#alerts .alert")).length === 7);
t("monitoring: three charts", (await p.$$("#charts .chart")).length === 3);
await p.close();

t("no page errors", errs.length === 0, errs);
await b.close();
console.log("\n" + ok + " passed, " + bad + " failed");
process.exit(bad ? 1 : 0);
