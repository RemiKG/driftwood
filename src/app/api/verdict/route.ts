// Run the full Driftwood loop for a fired saved search and return the verdict payload
// (the Shape Diff + Verdict Card both render off this). The decision is computed live.
import { NextRequest, NextResponse } from "next/server";
import { splunk } from "@/lib/splunk";
import { runVerdict } from "@/lib/loop";
import { SAVED_SEARCHES, ALERT_EARLIEST } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    savedSearch?: string;
    earliest?: string;
