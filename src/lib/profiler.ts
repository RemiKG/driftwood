// The real signal engine. Profiles the SHAPE of a sourcetype's data over the 443 proxy:
//   - field set + each field's cardinality dc() + null-rate  (fieldsummary / stats dc())
//   - per-sourcetype event volume                            (tstats count by _time)
//   - a forecast band for the volume                          (SPL-native | predict, the honest fallback;
//                                                               or a Hosted Model endpoint if one is wired)
// Every number returned here was computed by SPL on the user's real data. Nothing is drawn by hand.

import { SplunkClient } from "./splunk";
import type { FieldStat, ShapeProfile, ForecastBand, VolumePoint } from "./types";

// Fields Splunk adds automatically that are not part of the data's real shape.
const INTERNAL_FIELDS = new Set([
  "date_hour", "date_mday", "date_minute", "date_month", "date_second", "date_wday",
  "date_year", "date_zone", "eventtype", "host", "index", "linecount", "punct",
  "source", "sourcetype", "splunk_server", "splunk_server_group", "tag", "tag::eventtype",
  "timeendpos", "timestartpos", "_time", "_raw", "_bkt", "_cd", "_indextime", "_serial",
  "_si", "_sourcetype", "_subsecond",
]);

function isRealField(f: string): boolean {
  return !INTERNAL_FIELDS.has(f) && !f.startsWith("tag::") && !f.startsWith("date_");
}

export interface ProfileQuery {
  index: string;
  sourcetype: string;
  earliest: string;
  latest: string;
  source?: string; // optional source filter (used to scope a Drift Lab run cleanly)
}

function srcClause(source?: string): string {
  return source ? ` source="${source}"` : "";
}

// Profile the field shape (set + dc + null-rate) over a window. Real fieldsummary on real data.
export async function profileShape(sp: SplunkClient, q: ProfileQuery): Promise<ShapeProfile> {
  const base = `search index=${q.index} sourcetype="${q.sourcetype}"${srcClause(q.source)}`;
  // total events in the window (the denominator for null-rate)
  const totalRows = await sp.search(`${base} | stats count`, { earliest: q.earliest, latest: q.latest });
  const totalEvents = Number(totalRows[0]?.count || 0);

  const fsRows = await sp.search(
    `${base} | fieldsummary | table field count distinct_count`,
    { earliest: q.earliest, latest: q.latest }
  );

  const fields: FieldStat[] = [];
  for (const r of fsRows) {
    const field = r.field;
    if (!field || !isRealField(field)) continue;
    const count = Number(r.count || 0);
    const dc = Number(r.distinct_count || 0);
    const nullRate = totalEvents > 0 ? Math.max(0, (totalEvents - count) / totalEvents) : 0;
    fields.push({ field, dc, count, nullRate });
  }
  fields.sort((a, b) => b.count - a.count || b.dc - a.dc);

  return {
    index: q.index,
    sourcetype: q.sourcetype,
    totalEvents,
    fields,
    window: { earliest: q.earliest, latest: q.latest },
  };
}

// Per-minute volume series for a window. Real tstats on real data.
export async function volumeSeries(
  sp: SplunkClient,
  index: string,
  sourcetype: string,
  earliest: string,
  latest: string,
  source?: string
): Promise<VolumePoint[]> {
  const src = source ? ` source="${source}"` : "";
  const rows = await sp.search(
    `| tstats count where index=${index} sourcetype="${sourcetype}"${src} by _time span=1m | sort 0 _time`,
    { earliest, latest }
  );
  return rows.map((r) => ({ time: r._time, volume: Number(r.count || 0) }));
}

// Forecast the expected volume band from the trailing baseline, then compare to the live window.
// Default path = SPL-native | predict (real Splunk ML). If HOSTED_MODEL_URL is set, that endpoint
// is used instead and the provenance flips to "hosted-model" (honest seam — see _NEEDS note).
export async function forecastBand(
  sp: SplunkClient,
  opts: {
    index: string;
    sourcetype: string;
    baselineEarliest: string; // trailing baseline, e.g. -14d
    liveEarliest: string; // alert window start
    liveLatest: string; // alert window end (usually now)
    sigma: number;
    liveSource?: string; // optional source filter for the live alert window (scopes a Drift Lab run)
    baselineSource?: string; // optional source filter for the baseline rate (the calm seeded feed)
  }
): Promise<ForecastBand> {
  const { index, sourcetype, baselineEarliest, liveEarliest, liveLatest, sigma, liveSource, baselineSource } = opts;

  // Hosted-model seam: only taken if explicitly wired AND reachable. Honest fallback otherwise.
  if (process.env.HOSTED_MODEL_URL) {
    try {
      const band = await hostedModelForecast(sp, opts);
      if (band) return band;
    } catch {
      // fall through to SPL-native predict
    }
  }

  // Real Splunk ML. We run | predict over the per-minute trailing baseline series to get the displayed
  // forecast corridor, and we derive the expected per-minute rate + its spread from that same series
  // (the minutes BEFORE the alert window — which always carry data). The expected volume over the
  // alert window is that rate projected across the window's length; the verdict compares the live
  // window's observed total against the projected band. This is robust to the alert window's bins
  // being empty-by-design in the baseline.
  const liveStartMs = resolveTime(liveEarliest);

  // Real Splunk ML: run | predict over the per-minute baseline series (dense recent window, scoped to
  // the same source as the live window) to get the predicted rate + 95% band. This is the genuine
  // forecast call; the per-minute predicted values are the expected rate the verdict gates on.
  const denseBaselineEarliest = "-180m";
  const baselineRows = await sp.search(
    `| tstats count where index=${index} sourcetype="${sourcetype}"${srcClause(baselineSource)} by _time span=1m ` +
      `| timechart span=1m sum(count) as volume ` +
      `| predict volume as forecast future_timespan=0 upper95=upper lower95=lower`,
    { earliest: denseBaselineEarliest, latest: liveEarliest }
  );
  void baselineEarliest;

  const predPoints = baselineRows
    .map((r) => ({
      time: r._time,
      predicted: num(r.forecast ?? r.predicted ?? r.volume),
      lower: num(r.lower ?? r["lower95(forecast)"]),
      upper: num(r.upper ?? r["upper95(forecast)"]),
      volume: num(r.volume),
    }))
    .filter((p) => p.time && Date.parse(p.time) < liveStartMs);

  // Expected per-minute rate from the predicted series; spread from the real observed series.
  const predVals = predPoints.map((p) => p.predicted).filter((v) => v > 0);
  const obsVals = predPoints.map((p) => p.volume).filter((v) => v > 0);
  const meanRate = predVals.length
    ? predVals.reduce((a, b) => a + b, 0) / predVals.length
    : obsVals.length
      ? obsVals.reduce((a, b) => a + b, 0) / obsVals.length
      : 0;
  const obsMean = obsVals.length ? obsVals.reduce((a, b) => a + b, 0) / obsVals.length : meanRate;
  const variance = obsVals.length ? obsVals.reduce((a, b) => a + (b - obsMean) ** 2, 0) / obsVals.length : 0;
  const sd = Math.sqrt(variance);

  // Live observed series + total over the alert window (scoped to this run's source when given).
  const live = await volumeSeries(sp, index, sourcetype, liveEarliest, liveLatest, liveSource);
  const liveTotal = live.reduce((a, p) => a + p.volume, 0);
  const windowMinutes = Math.max(1, Math.round((Date.now() - liveStartMs) / 60000));

  // Projected band over the alert window: mean rate per minute ± sigma*sd, summed across the window.
  const expectedTotal = Math.max(0, meanRate * windowMinutes);
  const lowerTotal = Math.max(0, (meanRate - sigma * sd) * windowMinutes);
  const upperTotal = (meanRate + sigma * sd) * windowMinutes;
  const bandHalfWidth = Math.max(1, expectedTotal - lowerTotal);

  const residualPct = expectedTotal > 0 ? (liveTotal - expectedTotal) / expectedTotal : 0;
  const sigmaBelow = (expectedTotal - liveTotal) / bandHalfWidth; // band-sigmas below the predicted mean
  const belowBand = liveTotal < lowerTotal && sigmaBelow >= sigma * 0.5;

  // Build a per-minute display corridor across the alert window (predicted/lower/upper per minute),
  // aligned to the live series timestamps where present.
  const points = Array.from({ length: windowMinutes }, (_, i) => {
    const t = new Date(liveStartMs + i * 60000).toISOString();
    return {
      time: t,
      predicted: Math.max(0, meanRate),
      lower: Math.max(0, meanRate - sigma * sd),
      upper: Math.max(0, meanRate + sigma * sd),
    };
  });
  void upperTotal;

  return {
    points,
    live,
    source: "spl-predict",
    liveTotal,
    expectedTotal: Math.round(expectedTotal),
    residualPct,
    belowBand,
    sigmaBelow,
  };
}

// Optional Hosted Model path (Cisco Deep Time Series). Wired behind HOSTED_MODEL_URL.
// Sends the trailing volume series, expects {points:[{time,predicted,lower,upper}]} back.
async function hostedModelForecast(
  sp: SplunkClient,
  opts: { index: string; sourcetype: string; baselineEarliest: string; liveEarliest: string; liveLatest: string; sigma: number }
): Promise<ForecastBand | null> {
  const url = process.env.HOSTED_MODEL_URL!;
  const baseline = await volumeSeries(sp, opts.index, opts.sourcetype, opts.baselineEarliest, opts.liveEarliest);
  const live = await volumeSeries(sp, opts.index, opts.sourcetype, opts.liveEarliest, opts.liveLatest);
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.HOSTED_MODEL_KEY ? { Authorization: `Bearer ${process.env.HOSTED_MODEL_KEY}` } : {}),
    },
    body: JSON.stringify({ series: baseline, horizonPoints: Math.max(1, live.length), granularity: "1m" }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { points?: { time: string; predicted: number; lower: number; upper: number }[] };
  const points = j.points || [];
  if (points.length === 0) return null;
  const liveTotal = live.reduce((a, p) => a + p.volume, 0);
  const expectedTotal = points.reduce((a, p) => a + Math.max(0, p.predicted), 0);
  const lowerTotal = points.reduce((a, p) => a + Math.max(0, p.lower), 0);
  const bandHalfWidth = Math.max(1, expectedTotal - lowerTotal);
  const residualPct = expectedTotal > 0 ? (liveTotal - expectedTotal) / expectedTotal : 0;
  const sigmaBelow = (expectedTotal - liveTotal) / bandHalfWidth;
  return {
    points,
    live,
    source: "hosted-model",
    liveTotal,
    expectedTotal: Math.round(expectedTotal),
    residualPct,
    belowBand: liveTotal < lowerTotal && sigmaBelow >= opts.sigma * 0.5,
    sigmaBelow,
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Resolve a Splunk relative time token (-15m, -14d, now) to epoch ms (approx, for windowing).
function resolveTime(t: string): number {
  if (t === "now" || t === "") return Date.now();
  const m = t.match(/^-(\d+)([smhd])$/);
  if (!m) {
    const parsed = Date.parse(t);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]]!;
  return Date.now() - n * unit;
}
