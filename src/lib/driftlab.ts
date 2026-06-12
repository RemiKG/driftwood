// The Drift Lab — the clearly-separated demo path. It seeds ONLY the break (which field gets
// renamed, when traffic drops). The verdict is NEVER seeded; it is computed live by the loop from
// whichever break the judge chose. The lab sits ON TOP of the real path — same agent, same
// profiling SPL, same forecast oracle.
//
// Windowing model (so the live diff is honest): the baseline fills history from -BASELINE_MIN down
// to the start of the ALERT WINDOW, and leaves the alert window EMPTY. Each break arm then fills the
// alert window with whichever shape the judge chose. The verdict profiles only the alert window, so:
//   - rename arm: status is genuinely ABSENT in the window, http_status carries its cardinality -> NOISE
//   - drop arm:   status is intact but volume is ~80% below the band                          -> NEWS

import { SplunkClient } from "./splunk";
import { DEMO_INDEX, DRIFTLAB_SOURCETYPE, DRIFTLAB_SOURCE, ALERT_WINDOW_MIN, BASELINE_RATE_PER_MIN } from "./config";

// Measure the CURRENT calm-baseline per-minute rate from the real seeded feed, so the arms match it
// (rename holds volume in-band; drop falls ~80% below it) regardless of how often baseline was seeded.
export async function measureBaselineRate(sp: SplunkClient): Promise<number> {
  try {
    const rows = await sp.search(
      `| tstats count where index=${DEMO_INDEX} sourcetype="${DRIFTLAB_SOURCETYPE}" source="${DRIFTLAB_SOURCE}" by _time span=1m ` +
        `| stats avg(count) as rate`,
      { earliest: "-180m", latest: `-${ALERT_WINDOW_MIN}m` }
    );
    const rate = Math.round(Number(rows[0]?.rate || 0));
    return rate > 0 ? rate : BASELINE_RATE_PER_MIN;
  } catch {
    return BASELINE_RATE_PER_MIN;
  }
}

const STATUS_CODES = ["200", "200", "200", "200", "201", "204", "301", "302", "304", "400", "401", "403", "404", "409", "429", "500", "503"];
const REGIONS = ["us-east", "us-west", "eu-west", "ap-south"];

function rnd<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface EventOpts {
  ts: Date;
  statusField: "status" | "http_status";
}

function mkEvent(o: EventOpts): string {
  const code = rnd(STATUS_CODES);
  const userId = `u${1000 + Math.floor(Math.random() * 4200)}`;
  const region = rnd(REGIONS);
  const latency = 20 + Math.floor(Math.random() * 380);
  const srcIp = `10.${Math.floor(Math.random() * 4)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  return `${o.ts.toISOString()} user_id=${userId} ${o.statusField}=${code} region=${region} latency_ms=${latency} src_ip=${srcIp}`;
}

// Seed the trailing baseline. Dense recent history from -BASELINE_MIN down to the start of the alert
// window (NOT into the alert window), plus a sparse 14-day spread so | predict has a series.
export async function seedBaseline(
  sp: SplunkClient,
  opts: { baselineMinutes?: number; perMin?: number } = {}
): Promise<{ ingested: number }> {
  await sp.ensureIndex(DEMO_INDEX);
  const baselineMinutes = opts.baselineMinutes ?? 120;
  const perMin = opts.perMin ?? BASELINE_RATE_PER_MIN;
  const now = Date.now();

  const lines: string[] = [];
  // Dense recent baseline: from -baselineMinutes up to the EDGE of the alert window (exclusive).
  for (let m = baselineMinutes; m > ALERT_WINDOW_MIN; m--) {
    const per = perMin + Math.floor(Math.sin(m / 6) * 3);
    for (let i = 0; i < per; i++) {
      const ts = new Date(now - m * 60000 - Math.floor(Math.random() * 60000));
      lines.push(mkEvent({ ts, statusField: "status" }));
    }
  }
  // Sparse multi-day history so | predict has a real series to forecast from.
  for (let d = 14; d >= 1; d--) {
    for (let h = 0; h < 24; h += 2) {
      const ts = new Date(now - d * 86400000 + h * 3600000);
      const per = perMin + Math.floor(Math.sin(h / 4) * 4);
      for (let i = 0; i < per; i++) {
        lines.push(mkEvent({ ts: new Date(ts.getTime() + i * 1000), statusField: "status" }));
      }
    }
  }
  await ingestBatched(sp, lines, DRIFTLAB_SOURCE);
  return { ingested: lines.length };
}

// Each arm tags its events with a UNIQUE per-run source so the live alert window can be scoped to
// exactly the break the judge just triggered — prior experiments in the same index never bleed in.
// This stays 100% real Splunk data; it just isolates the run. Returns the runSource so the caller
// can profile precisely that window.
export interface ArmResult {
  ingested: number;
  runSource: string;
}

function runSource(): string {
  return `${DRIFTLAB_SOURCE}:${Date.now().toString(36)}`;
}

// ARM A — the rename. Fill the alert window with http_status (status absent), SAME cardinality,
// SAME volume rate as the current baseline (so volume holds inside the band). Only the break is seeded.
export async function armRename(sp: SplunkClient, opts: { perMin?: number } = {}): Promise<ArmResult> {
  const perMin = opts.perMin ?? (await measureBaselineRate(sp)); // match baseline -> volume holds
  return fillAlertWindow(sp, perMin, "http_status", runSource());
}

// ARM B — the traffic drop. Fill the alert window with status intact but volume ~80% below the
// current baseline. Only the break is seeded.
export async function armDrop(sp: SplunkClient, opts: { baselinePerMin?: number } = {}): Promise<ArmResult> {
  const baselinePerMin = opts.baselinePerMin ?? (await measureBaselineRate(sp));
  const dropped = Math.max(1, Math.round(baselinePerMin * 0.2)); // ~80% drop
  return fillAlertWindow(sp, dropped, "status", runSource());
}

// Reset-to-calm: fill the alert window with the current baseline rate, status intact, for a calm run.
export async function resetCalm(sp: SplunkClient, opts: { perMin?: number } = {}): Promise<ArmResult> {
  const perMin = opts.perMin ?? (await measureBaselineRate(sp));
  return fillAlertWindow(sp, perMin, "status", runSource());
}

// Fill the alert window (from -ALERT_WINDOW_MIN up to ~now) at a given rate with a chosen field name.
async function fillAlertWindow(
  sp: SplunkClient,
  perMin: number,
  statusField: "status" | "http_status",
  source: string
): Promise<ArmResult> {
  await sp.ensureIndex(DEMO_INDEX);
  const now = Date.now();
  const lines: string[] = [];
  // Leave the most recent ~30s out so events are safely in the past when Splunk indexes them.
  for (let m = ALERT_WINDOW_MIN - 1; m >= 0; m--) {
    for (let i = 0; i < perMin; i++) {
      const ts = new Date(now - m * 60000 - 30000 - Math.floor(Math.random() * 30000));
      lines.push(mkEvent({ ts, statusField }));
    }
  }
  await ingestBatched(sp, lines, source);
  return { ingested: lines.length, runSource: source };
}

async function ingestBatched(sp: SplunkClient, lines: string[], source: string, batch = 400): Promise<void> {
  for (let i = 0; i < lines.length; i += batch) {
    await sp.ingest(DEMO_INDEX, DRIFTLAB_SOURCETYPE, source, lines.slice(i, i + batch).join("\n"));
  }
}
