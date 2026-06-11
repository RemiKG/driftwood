// Splunk Cloud client over the 443 web REST proxy — adapted from the proven _tools/splunk-client.mjs.
// Auth = web session login (cval-cookie flow). No 8089 mgmt port, no ACS, no IP-allowlist.
// Works from this machine AND from a deployed backend (Cloud Run/Vercel) — 443 is public.
// Server-side only. Secrets come from env: SPLUNK_URL, SPLUNK_USER, SPLUNK_PASS, optional SPLUNK_LOCALE.

export interface SearchOpts {
  earliest?: string;
  latest?: string;
}

export interface SplunkRow {
  [key: string]: string;
}

export class SplunkClient {
  base: string;
  user: string;
  pass: string;
  locale: string;
  cookies: Record<string, string> = {};
  csrf = "";
  private loggedIn = false;

  constructor(opts: { url?: string; user?: string; pass?: string; locale?: string } = {}) {
    this.base = (opts.url || process.env.SPLUNK_URL || "").replace(/\/$/, "");
    this.user = opts.user || process.env.SPLUNK_USER || "";
    this.pass = opts.pass || process.env.SPLUNK_PASS || "";
    this.locale = opts.locale || process.env.SPLUNK_LOCALE || "en-GB";
  }

  private store(res: Response) {
    // Node 18+/undici exposes getSetCookie(); fall back to single header otherwise.
    const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
    const sc = anyHeaders.getSetCookie ? anyHeaders.getSetCookie() : [];
    for (const c of sc) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) this.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1);
    }
  }
  private cookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  private proxy(p: string) {
    return `${this.base}/${this.locale}/splunkd/__raw${p}`;
  }
  private headers(extra: Record<string, string> = {}) {
    return {
      Cookie: this.cookieHeader(),
      "X-Splunk-Form-Key": this.csrf,
      "X-Requested-With": "XMLHttpRequest",
      ...extra,
    };
  }

  async login(): Promise<this> {
    if (this.loggedIn) return this;
    if (!this.base || !this.user || !this.pass) {
      throw new Error("Splunk not configured: set SPLUNK_URL / SPLUNK_USER / SPLUNK_PASS");
    }
    let r = await fetch(`${this.base}/${this.locale}/account/login`, { redirect: "manual" });
    this.store(r);
    await r.text();
    const form = new URLSearchParams({
      username: this.user,
      password: this.pass,
      cval: this.cookies.cval || "",
      return_to: `/${this.locale}/app/launcher/home`,
    });
    r = await fetch(`${this.base}/${this.locale}/account/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this.cookieHeader() },
      body: form.toString(),
    });
    this.store(r);
    if (r.status >= 400) throw new Error("Splunk login failed: " + r.status);
    const k = Object.keys(this.cookies).find((x) => x.startsWith("splunkweb_csrf_token"));
    this.csrf = k ? this.cookies[k] : "";
    this.loggedIn = true;
    return this;
  }

  async search(spl: string, { earliest = "-24h", latest = "now" }: SearchOpts = {}): Promise<SplunkRow[]> {
    await this.login();
    const body = new URLSearchParams({
      search: spl.startsWith("|") || spl.startsWith("search") ? spl : "search " + spl,
      exec_mode: "oneshot",
      output_mode: "json",
      earliest_time: earliest,
      latest_time: latest,
      count: "0",
    });
    const r = await fetch(this.proxy("/services/search/jobs"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: body.toString(),
    });
    const t = await r.text();
    if (r.status >= 400) throw new Error(`search ${r.status}: ${t.slice(0, 300)}`);
    return (JSON.parse(t).results as SplunkRow[]) || [];
  }

  async ingest(index: string, sourcetype: string, source: string, eventText: string): Promise<boolean> {
    await this.login();
    const r = await fetch(
      this.proxy(
        `/services/receivers/simple?index=${encodeURIComponent(index)}&sourcetype=${encodeURIComponent(
          sourcetype
        )}&source=${encodeURIComponent(source)}`
      ),
      { method: "POST", headers: this.headers({ "Content-Type": "text/plain" }), body: eventText }
    );
    if (r.status >= 400) throw new Error("ingest " + r.status + " " + (await r.text()).slice(0, 200));
    return true;
  }

  async listIndexes(): Promise<string[]> {
    await this.login();
    const r = await fetch(this.proxy("/services/data/indexes?output_mode=json&count=0&search=isInternal=0"), {
      headers: this.headers(),
    });
    return (JSON.parse(await r.text()).entry as { name: string }[]).map((e) => e.name);
  }

  async ensureIndex(name: string): Promise<boolean> {
    const have = await this.listIndexes();
    if (have.includes(name)) return false;
    const r = await fetch(this.proxy("/services/data/indexes"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({ name, output_mode: "json" }).toString(),
    });
    if (r.status >= 400) throw new Error("ensureIndex " + r.status + " " + (await r.text()).slice(0, 200));
    return true;
  }

  // Call the official Splunk MCP Server IF installed (app 7931 exposes /services/mcp).
  // Reachable via the same proxy. Returns null if not installed (graceful seam).
  async mcp(path = "", init: RequestInit = {}): Promise<Response | null> {
    await this.login();
    const r = await fetch(this.proxy("/services/mcp" + path), {
      ...init,
      headers: this.headers((init.headers as Record<string, string>) || {}),
    });
    if (r.status === 404) return null;
    return r;
  }
}

// One shared client per server process — re-uses the session cookie across requests.
let shared: SplunkClient | null = null;
export function splunk(): SplunkClient {
  if (!shared) shared = new SplunkClient();
  return shared;
}
