// Decision gates + agent settings: read and tune. Gemini reasons over numbers SPL computed; the
// gates are the numbers that turn signal into verdict. No secrets here — connection lives in env.
import { NextRequest, NextResponse } from "next/server";
import { getGates, setGates, agentSettings, BASELINE_WINDOW_DAYS, VERDICT_INDEX, DEMO_INDEX } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    gates: getGates(),
    agent: agentSettings,
    baselineWindowDays: BASELINE_WINDOW_DAYS,
    demoIndex: DEMO_INDEX,
    verdictIndex: VERDICT_INDEX,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    cardinalityMatchThreshold?: number;
    forecastBandSigma?: number;
    minHistoryDays?: number;
    temperature?: number;
  };
  const next = setGates({
    cardinalityMatchThreshold: body.cardinalityMatchThreshold,
    forecastBandSigma: body.forecastBandSigma,
    minHistoryDays: body.minHistoryDays,
  });
  if (typeof body.temperature === "number") agentSettings.temperature = body.temperature;
  return NextResponse.json({ gates: next, agent: agentSettings });
}
