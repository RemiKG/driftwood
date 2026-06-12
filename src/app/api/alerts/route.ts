// The Shore's recent-alerts lane + KPI counters, read from real verdict annotations in
// index=driftwood_verdicts. No mock — every row was written by the loop on a live decision.
import { NextResponse } from "next/server";
import { splunk } from "@/lib/splunk";
import { VERDICT_INDEX } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sp = splunk();
  try {
    const rows = await sp.search(
      `search index=${VERDICT_INDEX} sourcetype="driftwood:verdict" ` +
        `| spath ` +
        // Splunk auto-extracts JSON AND spath extracts again -> fields can be multivalue; take first.
        `| eval event_id=mvindex(event_id,0), saved_search=mvindex(saved_search,0), verdict=mvindex(verdict,0), ` +
        `drifted_field=mvindex(drifted_field,0), residual_pct=mvindex(residual_pct,0), ` +
        `time_to_verdict_ms=mvindex(time_to_verdict_ms,0), forecast_source=mvindex(forecast_source,0), sentence=mvindex(sentence,0) ` +
        `| sort 0 -_time ` +
        `| table _time event_id saved_search verdict drifted_field residual_pct time_to_verdict_ms forecast_source sentence ` +
        `| head 50`,
      { earliest: "-7d", latest: "now" }
    );

    const alerts = rows.map((r) => ({
      time: r._time,
      eventId: r.event_id,
      savedSearch: r.saved_search,
      verdict: r.verdict,
      driftedField: r.drifted_field === "none" ? null : r.drifted_field,
      residualPct: Number(r.residual_pct || 0),
      timeToVerdictMs: Number(r.time_to_verdict_ms || 0),
      forecastSource: r.forecast_source,
      sentence: r.sentence,
    }));

    const today = new Date().toISOString().slice(0, 10);
    const todays = alerts.filter((a) => (a.time || "").slice(0, 10) === today);
    const noiseToday = todays.filter((a) => a.verdict === "NOISE").length;
    const ttvs = alerts.map((a) => a.timeToVerdictMs).filter((n) => n > 0).sort((a, b) => a - b);
    const medianTtv = ttvs.length ? ttvs[Math.floor(ttvs.length / 2)] / 1000 : 0;
    const fieldsDrifted = new Set(alerts.filter((a) => a.driftedField).map((a) => a.driftedField)).size;

    return NextResponse.json({
      alerts,
      kpis: {
        noisePagesCaughtToday: noiseToday,
        medianTimeToVerdictSec: Number(medianTtv.toFixed(1)),
        fieldsDriftedThisWeek: fieldsDrifted,
        verdictsBackedBySpl: 100,
      },
    });
  } catch (e) {
    return NextResponse.json({ alerts: [], kpis: null, error: (e as Error).message });
  }
}
