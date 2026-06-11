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

