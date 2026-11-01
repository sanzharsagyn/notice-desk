// Local development server: the real Worker code, in-memory KV, static files from public/.
//   node tests/dev-server.mjs            -> mock model (no key, no cost), answers derived from the reference labels
//   ANTHROPIC_API_KEY=... node tests/dev-server.mjs --live   -> real model calls
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/worker.js";
import { mockAnswer, mockFetch, mockAIBinding } from "./mock-model.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(here, "../public");
const PORT = Number(process.env.PORT || 8790);
const live = process.argv.includes("--live");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

if (!live) globalThis.fetch = mockFetch(globalThis.fetch, { delayMs: 120 });

const store = new Map();
const env = {
  ANTHROPIC_API_KEY: live ? process.env.ANTHROPIC_API_KEY : "mock",
  DAILY_LIMIT: "5000",
  AI: live ? undefined : mockAIBinding({ delayMs: 40 }),
  KV: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } },
  ASSETS: { fetch: async (req) => {
    const u = new URL(req.url);
    let f = path.join(PUB, decodeURIComponent(u.pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!f.startsWith(PUB) || !fs.existsSync(f)) return new Response("Not found", { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { "content-type": types[path.extname(f)] || "application/octet-stream" } });
  } },
};

http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const r = await worker.fetch(new Request("http://localhost:" + PORT + req.url, { method: req.method, headers: { "content-type": req.headers["content-type"] || "text/plain", "cf-connecting-ip": "127.0.0.1" }, body: req.method === "POST" ? body : undefined }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log("Notice Desk on http://localhost:" + PORT + (live ? " (live model)" : " (mock model)")));
export { mockAnswer };
