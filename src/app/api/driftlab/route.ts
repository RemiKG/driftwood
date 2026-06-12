// Drift Lab control surface. Seeds ONLY the break (rename / drop / reset / baseline) into the real
// index, then the caller runs the live loop to get the verdict. The verdict is NEVER seeded here.
import { NextRequest, NextResponse } from "next/server";
import { splunk } from "@/lib/splunk";
import { seedBaseline, armRename, armDrop, resetCalm } from "@/lib/driftlab";
import { captureFingerprint } from "@/lib/loop";
import { SAVED_SEARCHES } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const sp = splunk();
  try {
    switch (action) {
      case "seed": {
        // Full baseline seed + (re)capture the fingerprint so the diff has something to compare to.
        const r = await seedBaseline(sp);
        // give Splunk a moment to make the most recent events searchable before fingerprinting
        await new Promise((res) => setTimeout(res, 4000));
        await captureFingerprint(sp, SAVED_SEARCHES[0].name);
        return NextResponse.json({ ok: true, action, ...r });
      }
      case "rename": {
        const r = await armRename(sp);
        return NextResponse.json({ ok: true, action, ...r });
      }
      case "drop": {
        const r = await armDrop(sp);
        return NextResponse.json({ ok: true, action, ...r });
      }
      case "reset": {
        const r = await resetCalm(sp);
        return NextResponse.json({ ok: true, action, ...r });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
