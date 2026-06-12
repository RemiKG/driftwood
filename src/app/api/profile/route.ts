// Returns the baseline fingerprint + a fresh live profile for the Shape Diff screen, plus the
// diff and the forecast band — all computed live from real Splunk data.
import { NextRequest, NextResponse } from "next/server";
import { splunk } from "@/lib/splunk";
import { profileShape, forecastBand } from "@/lib/profiler";
import { diffShape } from "@/lib/verdict";
import { captureFingerprint } from "@/lib/loop";
import { SAVED_SEARCHES, getFingerprint, getGates, BASELINE_WINDOW_DAYS, ALERT_EARLIEST, DRIFTLAB_SOURCE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const savedSearch = url.searchParams.get("savedSearch") || SAVED_SEARCHES[0].name;
  const earliest = url.searchParams.get("earliest") || ALERT_EARLIEST;
  const latest = url.searchParams.get("latest") || "now";
  const source = url.searchParams.get("source") || undefined;

  const def = SAVED_SEARCHES.find((s) => s.name === savedSearch);
  if (!def) return NextResponse.json({ error: "unknown saved search" }, { status: 404 });

  const sp = splunk();
  try {
    let fp = getFingerprint(savedSearch);
    if (!fp) fp = await captureFingerprint(sp, savedSearch);

    const live = await profileShape(sp, { index: def.index, sourcetype: def.sourcetype, earliest, latest, source });
    const gates = getGates();
    const diff = diffShape(fp.profile, live, def.dependsOnField, gates);
    const forecast = await forecastBand(sp, {
      index: def.index,
      sourcetype: def.sourcetype,
      baselineEarliest: `-${BASELINE_WINDOW_DAYS}d`,
      liveEarliest: earliest,
      liveLatest: latest,
      sigma: gates.forecastBandSigma,
      liveSource: source,
      baselineSource: def.isLab ? DRIFTLAB_SOURCE : undefined,
    });

    return NextResponse.json({
      savedSearch,
      sourcetype: def.sourcetype,
      window: { earliest, latest },
      baseline: fp.profile,
      live,
      diff,
      forecast,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
