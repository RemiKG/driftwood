// Read a single written verdict annotation back out of index=driftwood_verdicts by event id.
// Proves the verdict persisted as a real Splunk event (the annotation receipt is auditable).
import { NextRequest, NextResponse } from "next/server";
import { splunk } from "@/lib/splunk";
import { VERDICT_INDEX } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = splunk();
  try {
    const rows = await sp.search(
      `search index=${VERDICT_INDEX} sourcetype="driftwood:verdict" "${id}" | spath ` +
        `| eval event_id=mvindex(event_id,0), drifted_field=mvindex(drifted_field,0), verdict=mvindex(verdict,0) ` +
        `| search event_id="${id}" | head 1`,
      { earliest: "-30d", latest: "now" }
    );
    if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ event: rows[0] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
