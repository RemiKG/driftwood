// Fingerprint Library data + a recalibrate action. Captures the baseline shape-fingerprint from the
// user's real trailing-window data over the 443 proxy.
import { NextRequest, NextResponse } from "next/server";
import { splunk } from "@/lib/splunk";
import { captureFingerprint } from "@/lib/loop";
import { SAVED_SEARCHES, allFingerprints, getFingerprint } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sp = splunk();
  // Lazily capture any missing fingerprints so the library is populated on first view.
  for (const def of SAVED_SEARCHES) {
    if (!getFingerprint(def.name)) {
      try {
        await captureFingerprint(sp, def.name);
      } catch {
        // leave it absent; UI shows "not yet calibrated"
      }
    }
  }
  return NextResponse.json({ fingerprints: allFingerprints() });
}

export async function POST(req: NextRequest) {
  const { savedSearch } = (await req.json().catch(() => ({}))) as { savedSearch?: string };
  const sp = splunk();
  try {
    if (savedSearch) {
      const fp = await captureFingerprint(sp, savedSearch);
      return NextResponse.json({ fingerprint: fp });
    }
    const out = [];
    for (const def of SAVED_SEARCHES) out.push(await captureFingerprint(sp, def.name));
    return NextResponse.json({ fingerprints: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
