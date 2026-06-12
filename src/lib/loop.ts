// The Driftwood loop, end to end:
//   saved search alerts -> profile live shape (tstats + fieldsummary + dc()) -> diff vs stored fingerprint
//   -> forecast expected volume (Hosted Model or SPL predict) -> classify NOISE/NEWS (deterministic gate)
//   -> Gemini names the drifted field + writes the THW sentence -> write verdict annotation to
//      index=driftwood_verdicts -> return the payload the UI renders.

import { SplunkClient } from "./splunk";
import { profileShape, forecastBand } from "./profiler";
import { diffShape, classify, narrate, buildReRunnableSpl } from "./verdict";
import {
  SAVED_SEARCHES,
  VERDICT_INDEX,
  BASELINE_WINDOW_DAYS,
  DRIFTLAB_SOURCE,
  getGates,
  getFingerprint,
  putFingerprint,
  agentSettings,
} from "./config";
import type { Verdict, Fingerprint, ShapeProfile } from "./types";

// Capture (or recapture) the baseline shape-fingerprint for a saved search over the trailing window.
export async function captureFingerprint(sp: SplunkClient, savedSearch: string): Promise<Fingerprint> {
  const def = SAVED_SEARCHES.find((s) => s.name === savedSearch);
  if (!def) throw new Error(`Unknown saved search: ${savedSearch}`);

  const baselineEarliest = `-${BASELINE_WINDOW_DAYS}d`;
  // For the Drift Lab saved search, the baseline is the CALM seeded feed (source=driftlab:payments).
  // Break arms write run-suffixed sources, so scoping here keeps the fingerprint clean (status only)
  // no matter how many breaks were triggered before.
  const baselineSource = def.isLab ? DRIFTLAB_SOURCE : undefined;
  const profile = await profileShape(sp, {
    index: def.index,
    sourcetype: def.sourcetype,
    earliest: baselineEarliest,
    latest: "now",
    source: baselineSource,
  });

  // Confidence is low if the sourcetype has little history (spread of distinct days seen).
  const srcClause = baselineSource ? ` source="${baselineSource}"` : "";
  const dayRows = await sp.search(
    `search index=${def.index} sourcetype="${def.sourcetype}"${srcClause} | bin _time span=1d | stats dc(_time) as days`,
    { earliest: baselineEarliest, latest: "now" }
  );
  const days = Number(dayRows[0]?.days || 0);
  const confidence: Fingerprint["confidence"] = days >= getGates().minHistoryDays ? "full" : "low";

  const fp: Fingerprint = {
    savedSearch,
    index: def.index,
    sourcetype: def.sourcetype,
    dependsOnField: def.dependsOnField,
    baselineWindowDays: BASELINE_WINDOW_DAYS,
    capturedAt: new Date().toISOString(),
    lastRecalibrated: new Date().toISOString(),
    confidence,
    profile,
    forecastSource: agentSettings.forecastSource,
  };
  putFingerprint(fp);
  return fp;
}

// Run the full loop for a fired saved search over its alert window.
export async function runVerdict(
  sp: SplunkClient,
  savedSearch: string,
  alertWindow: { earliest: string; latest: string; source?: string }
): Promise<Verdict> {
  const t0 = Date.now();
  const def = SAVED_SEARCHES.find((s) => s.name === savedSearch);
  if (!def) throw new Error(`Unknown saved search: ${savedSearch}`);

  // Ensure we have a baseline to diff against.
  let fp = getFingerprint(savedSearch);
  if (!fp) fp = await captureFingerprint(sp, savedSearch);

  // The live alert window is scoped to this run's source when the Drift Lab provides one, so a
  // freshly-triggered break isn't diluted by prior experiments in the same index. The baseline
  // rate uses the calm seeded feed source.
  const liveSource = alertWindow.source;
  const baselineSource = def.isLab ? DRIFTLAB_SOURCE : undefined;

  // 1. Profile the live shape over the alert window (real fieldsummary + dc()).
  const live: ShapeProfile = await profileShape(sp, {
    index: def.index,
    sourcetype: def.sourcetype,
    earliest: alertWindow.earliest,
    latest: alertWindow.latest,
    source: liveSource,
  });

  const gates = getGates();

  // 2. Diff live vs baseline fingerprint.
  const diff = diffShape(fp.profile, live, def.dependsOnField, gates);

  // 3. Forecast the expected volume band and compute the live residual (real Splunk ML).
  const forecast = await forecastBand(sp, {
    index: def.index,
    sourcetype: def.sourcetype,
    baselineEarliest: `-${BASELINE_WINDOW_DAYS}d`,
    liveEarliest: alertWindow.earliest,
    liveLatest: alertWindow.latest,
    sigma: gates.forecastBandSigma,
    liveSource,
    baselineSource,
  });

  // 4. Classify — DETERMINISTIC, never faked.
  const label = classify(diff, forecast, gates);

  // 5. Gemini names the drifted field + writes the one-sentence verdict (cannot change the label).
  const { sentence, driftedField, reasonedBy } = await narrate(
    label,
    diff,
    forecast,
    savedSearch,
    agentSettings.temperature
  );

  const reUnnableSpl = buildReRunnableSpl(def.index, def.sourcetype, diff, alertWindow.earliest);
  const cm = diff.cardinalityMatch;
  const cardinalityDelta = cm ? `dc ${cm.goneDc} ${cm.isRename ? "≡" : "≠"} ${cm.newDc}` : "—";
  const nullShift =
    diff.fields.find((f) => f.field === def.dependsOnField)?.liveNullRate != null
      ? `${(((diff.fields.find((f) => f.field === def.dependsOnField)?.liveNullRate ?? 0) -
          (diff.fields.find((f) => f.field === def.dependsOnField)?.baselineNullRate ?? 0)) *
          100
        ).toFixed(1)}%`
      : "0.0%";

  const id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const verdict: Verdict = {
    id,
    savedSearch,
    index: def.index,
    sourcetype: def.sourcetype,
    label,
    driftedField,
    sentence,
    reUnnableSpl,
    forecast,
    diff,
    residualPct: forecast.residualPct,
    cardinalityDelta,
    nullRateShift: nullShift,
    timeToVerdictMs: Date.now() - t0,
    forecastSource: forecast.source,
    reasonedBy,
    writtenEventId: null,
    runSource: liveSource || null,
    createdAt: new Date().toISOString(),
  };

  // 6. Write the verdict annotation back into Splunk (real event into index=driftwood_verdicts).
  verdict.writtenEventId = await writeVerdict(sp, verdict);
  return verdict;
}

async function writeVerdict(sp: SplunkClient, v: Verdict): Promise<string | null> {
  try {
    await sp.ensureIndex(VERDICT_INDEX);
    const event = {
      ts: v.createdAt,
      event_id: v.id,
      saved_search: v.savedSearch,
      verdict: v.label,
      drifted_field: v.driftedField || "none",
      residual_pct: Number((v.residualPct * 100).toFixed(2)),
      forecast_source: v.forecastSource,
      cardinality_delta: v.cardinalityDelta,
      time_to_verdict_ms: v.timeToVerdictMs,
      reasoned_by: v.reasonedBy,
      rerunnable_spl: v.reUnnableSpl,
      sentence: v.sentence,
    };
    // Write as a single JSON object per event. Splunk auto-parses JSON sourcetypes, and reads use
    // `| spath` so every field (incl. the unicode arrow and quoted SPL) round-trips losslessly.
    await sp.ingest(VERDICT_INDEX, "driftwood:verdict", "driftwood:agent", JSON.stringify(event));
    return v.id;
  } catch {
    return null;
  }
}
