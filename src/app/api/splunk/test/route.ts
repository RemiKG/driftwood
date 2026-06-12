// Connection test for the Settings page: returns the reachable surface (search jobs, MCP app 7931,
// Hosted Models, Gemini) — honest about which primitives are live vs. running on the fallback.
import { NextResponse } from "next/server";
import { splunk } from "@/lib/splunk";
import { geminiConfigured } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = {
    splunkUrl: process.env.SPLUNK_URL || null,
    searchJobs: false,
    indexes: [] as string[],
    mcpApp7931: false,
    hostedModels: Boolean(process.env.HOSTED_MODEL_URL),
    gemini: geminiConfigured(),
    baselineWindowDays: Number(process.env.BASELINE_WINDOW_DAYS || 14),
    error: null as string | null,
  };
  try {
    const sp = splunk();
    await sp.login();
    const idx = await sp.listIndexes();
    result.searchJobs = true;
    result.indexes = idx;
    const mcp = await sp.mcp("");
    result.mcpApp7931 = mcp !== null;
  } catch (e) {
    result.error = (e as Error).message;
  }
  return NextResponse.json(result);
}
