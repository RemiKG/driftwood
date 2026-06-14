// CLI seeder — ensure the demo + verdict indexes exist and seed a realistic baseline so the money
// shot runs on REAL Splunk data. Run once before the demo:  npm run seed
// Env: SPLUNK_URL / SPLUNK_USER / SPLUNK_PASS.

const DEMO_INDEX = process.env.DRIFTWOOD_DEMO_INDEX || "driftwood_demo";
const VERDICT_INDEX = process.env.DRIFTWOOD_VERDICT_INDEX || "driftwood_verdicts";
const SOURCETYPE = "cisco:auth";
const SOURCE = "driftlab:payments";

class Splunk {
  constructor() {
    this.base = (process.env.SPLUNK_URL || "").replace(/\/$/, "");
    this.user = process.env.SPLUNK_USER;
    this.pass = process.env.SPLUNK_PASS;
    this.locale = process.env.SPLUNK_LOCALE || "en-GB";
    this.cookies = {};
    this.csrf = "";
  }
  _store(r) { const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : []; for (const c of sc) { const kv = c.split(";")[0]; const i = kv.indexOf("="); if (i > 0) this.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1); } }
  _ch() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  _proxy(p) { return `${this.base}/${this.locale}/splunkd/__raw${p}`; }
  _h(extra = {}) { return { Cookie: this._ch(), "X-Splunk-Form-Key": this.csrf, "X-Requested-With": "XMLHttpRequest", ...extra }; }
  async login() {
    let r = await fetch(`${this.base}/${this.locale}/account/login`, { redirect: "manual" }); this._store(r); await r.text();
    const form = new URLSearchParams({ username: this.user, password: this.pass, cval: this.cookies.cval || "", return_to: `/${this.locale}/app/launcher/home` });
    r = await fetch(`${this.base}/${this.locale}/account/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this._ch() }, body: form.toString() });
    this._store(r); if (r.status >= 400) throw new Error("login " + r.status);
    const k = Object.keys(this.cookies).find((x) => x.startsWith("splunkweb_csrf_token")); this.csrf = k ? this.cookies[k] : "";
  }
  async listIndexes() { const r = await fetch(this._proxy("/services/data/indexes?output_mode=json&count=0&search=isInternal=0"), { headers: this._h() }); return JSON.parse(await r.text()).entry.map((e) => e.name); }
  async ensureIndex(name) { const have = await this.listIndexes(); if (have.includes(name)) return false; const r = await fetch(this._proxy("/services/data/indexes"), { method: "POST", headers: this._h({ "Content-Type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ name, output_mode: "json" }).toString() }); if (r.status >= 400) throw new Error("ensureIndex " + r.status); return true; }
  async ingest(index, st, src, text) { const r = await fetch(this._proxy(`/services/receivers/simple?index=${index}&sourcetype=${st}&source=${src}`), { method: "POST", headers: this._h({ "Content-Type": "text/plain" }), body: text }); if (r.status >= 400) throw new Error("ingest " + r.status); }
}

const CODES = ["200", "200", "200", "200", "201", "204", "301", "302", "304", "400", "401", "403", "404", "409", "429", "500", "503"];
const REGIONS = ["us-east", "us-west", "eu-west", "ap-south"];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const mk = (ts, fld) => `${ts.toISOString()} user_id=u${1000 + Math.floor(Math.random() * 4200)} ${fld}=${rnd(CODES)} region=${rnd(REGIONS)} latency_ms=${20 + Math.floor(Math.random() * 380)} src_ip=10.${Math.floor(Math.random() * 4)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

async function main() {
  const sp = new Splunk();
  await sp.login();
  console.log("logged in");
  await sp.ensureIndex(DEMO_INDEX);
  await sp.ensureIndex(VERDICT_INDEX);
  console.log("indexes ready:", DEMO_INDEX, VERDICT_INDEX);

  const now = Date.now();
  const lines = [];
  // dense recent baseline
  for (let m = 90; m >= 1; m--) { const per = 14 + Math.floor(Math.sin(m / 6) * 3); for (let i = 0; i < per; i++) lines.push(mk(new Date(now - m * 60000 - Math.floor(Math.random() * 60000)), "status")); }
  // sparse 14-day history for predict()
  for (let d = 14; d >= 1; d--) for (let h = 0; h < 24; h += 2) { const t = new Date(now - d * 86400000 + h * 3600000); const per = 14 + Math.floor(Math.sin(h / 4) * 4); for (let i = 0; i < per; i++) lines.push(mk(new Date(t.getTime() + i * 1000), "status")); }

  for (let i = 0; i < lines.length; i += 400) { await sp.ingest(DEMO_INDEX, SOURCETYPE, SOURCE, lines.slice(i, i + 400).join("\n")); }
  console.log(`seeded ${lines.length} baseline events into ${DEMO_INDEX} (sourcetype=${SOURCETYPE})`);
  console.log("done. Open the app, go to Drift Lab, and run an arm.");
}

main().catch((e) => { console.error(e); process.exit(1); });
