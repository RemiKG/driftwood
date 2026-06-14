// Driftwood MCP server — a tiny Model Context Protocol server (JSON-RPC 2.0 over stdio) that wraps
// the Splunk 443 client as read tools. This makes "the agent gathers its profile through MCP search
// tools" REAL even when the official Splunk MCP Server (app 7931) is not installed on the trial.
//
// Tools exposed:
//   splunk_search(spl, earliest?, latest?)        -> rows
//   splunk_fieldsummary(index, sourcetype, earliest?, latest?) -> field set + dc() + count
//   splunk_volume(index, sourcetype, earliest?, latest?, span?) -> per-bin volume series
//
// Run:  node mcp/server.mjs    (speaks MCP over stdio; point any MCP client at it)
// Env:  SPLUNK_URL / SPLUNK_USER / SPLUNK_PASS (same as the app).

import readline from "node:readline";

// NOTE: src/lib/splunk.ts is TypeScript. To stay a zero-build standalone process, this server
// re-implements the minimal Splunk client inline. (The web app uses the typed client directly.)
class Splunk {
  constructor() {
    this.base = (process.env.SPLUNK_URL || "").replace(/\/$/, "");
    this.user = process.env.SPLUNK_USER;
    this.pass = process.env.SPLUNK_PASS;
    this.locale = process.env.SPLUNK_LOCALE || "en-GB";
    this.cookies = {};
    this.csrf = "";
  }
  _store(r) {
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) { const kv = c.split(";")[0]; const i = kv.indexOf("="); if (i > 0) this.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1); }
  }
  _ch() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  _proxy(p) { return `${this.base}/${this.locale}/splunkd/__raw${p}`; }
  _h(extra = {}) { return { Cookie: this._ch(), "X-Splunk-Form-Key": this.csrf, "X-Requested-With": "XMLHttpRequest", ...extra }; }
  async login() {
    let r = await fetch(`${this.base}/${this.locale}/account/login`, { redirect: "manual" }); this._store(r); await r.text();
    const form = new URLSearchParams({ username: this.user, password: this.pass, cval: this.cookies.cval || "", return_to: `/${this.locale}/app/launcher/home` });
    r = await fetch(`${this.base}/${this.locale}/account/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this._ch() }, body: form.toString() });
    this._store(r); if (r.status >= 400) throw new Error("login " + r.status);
    const k = Object.keys(this.cookies).find((x) => x.startsWith("splunkweb_csrf_token")); this.csrf = k ? this.cookies[k] : "";
    return this;
  }
  async search(spl, { earliest = "-24h", latest = "now" } = {}) {
    const body = new URLSearchParams({ search: spl.startsWith("|") || spl.startsWith("search") ? spl : "search " + spl, exec_mode: "oneshot", output_mode: "json", earliest_time: earliest, latest_time: latest, count: "0" });
    const r = await fetch(this._proxy("/services/search/jobs"), { method: "POST", headers: this._h({ "Content-Type": "application/x-www-form-urlencoded" }), body: body.toString() });
    const t = await r.text(); if (r.status >= 400) throw new Error("search " + r.status); return JSON.parse(t).results || [];
  }
}

const sp = new Splunk();
let ready = sp.login().catch((e) => { console.error("Splunk login failed:", e.message); });

const TOOLS = [
  { name: "splunk_search", description: "Run an SPL search over the 443 proxy and return rows.", inputSchema: { type: "object", properties: { spl: { type: "string" }, earliest: { type: "string" }, latest: { type: "string" } }, required: ["spl"] } },
  { name: "splunk_fieldsummary", description: "Field set + cardinality dc() + count for a sourcetype window.", inputSchema: { type: "object", properties: { index: { type: "string" }, sourcetype: { type: "string" }, earliest: { type: "string" }, latest: { type: "string" } }, required: ["index", "sourcetype"] } },
  { name: "splunk_volume", description: "Per-bin event volume series for a sourcetype window.", inputSchema: { type: "object", properties: { index: { type: "string" }, sourcetype: { type: "string" }, earliest: { type: "string" }, latest: { type: "string" }, span: { type: "string" } }, required: ["index", "sourcetype"] } },
];

async function call(name, args) {
  await ready;
  if (name === "splunk_search") return sp.search(args.spl, { earliest: args.earliest, latest: args.latest });
  if (name === "splunk_fieldsummary") return sp.search(`search index=${args.index} sourcetype="${args.sourcetype}" | fieldsummary | table field count distinct_count`, { earliest: args.earliest || "-15m", latest: args.latest || "now" });
  if (name === "splunk_volume") return sp.search(`| tstats count where index=${args.index} sourcetype="${args.sourcetype}" by _time span=${args.span || "1m"}`, { earliest: args.earliest || "-15m", latest: args.latest || "now" });
  throw new Error("unknown tool " + name);
}

const rl = readline.createInterface({ input: process.stdin });
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "driftwood-splunk-mcp", version: "1.0.0" }, capabilities: { tools: {} } } });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
      const rows = await call(params.name, params.arguments || {});
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(rows) }] } });
    } else if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
    }
  } catch (e) {
    if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e.message || e) } });
  }
});

console.error("driftwood-splunk-mcp listening on stdio");
