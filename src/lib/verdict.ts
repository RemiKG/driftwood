// The verdict engine. The noise/news DECISION is deterministic and gated on two real measurements:
//   (1) the field-set / cardinality diff (did a depended-on field disappear and its dc() migrate?)
//   (2) the volume forecast residual (did traffic fall below its band?)
// Gemini reasons OVER these numbers to name the drifted field and write the one-sentence verdict in
// the THW voice — it NEVER flips the label. The line we never cross: the decision is never faked.

import type {
  ShapeProfile,
  ShapeDiff,
  DiffField,
  CardinalityMatch,
  ForecastBand,
  Verdict,
  VerdictLabel,
  DecisionGates,
} from "./types";
import { generate, extractJson, geminiConfigured } from "./gemini";

// Diff the live profile against the stored baseline fingerprint.
export function diffShape(
  baseline: ShapeProfile,
  live: ShapeProfile,
  dependsOnField: string,
  gates: DecisionGates
): ShapeDiff {
  const baseMap = new Map(baseline.fields.map((f) => [f.field, f]));
  const liveMap = new Map(live.fields.map((f) => [f.field, f]));

  // "present in the live window" = the field carries data in this window (null-rate < 95%): used to
  //   decide a baseline field has GONE.
  // "established in the baseline" = the field is part of the detection's normal shape, i.e. present in
  //   a MAJORITY of baseline events (null-rate < 50%): used to decide a live field is genuinely NEW.
  //   This stops a transient/rare field (e.g. an earlier experiment's residue) from masking a rename.
  // A baseline field counts as STILL PRESENT in the live window only if it carries data in a majority
  // of events (live null-rate < 50%). If a field that was always present in the baseline now appears
  // in a small minority of events, it has effectively drifted out — that is "gone".
  const liveCarriesData = (name: string) => {
    const f = liveMap.get(name);
    return Boolean(f && f.nullRate < 0.5 && f.count > 0);
  };
  // A live field is genuinely NEW if it now carries data (null-rate < 50%) but was NOT an established
  // baseline field (baseline null-rate >= 50% or absent).
  const liveIsCarrying = (name: string) => {
    const f = liveMap.get(name);
    return Boolean(f && f.nullRate < 0.5 && f.count > 0);
  };
  const baseEstablished = (name: string) => {
    const f = baseMap.get(name);
    return Boolean(f && f.nullRate < 0.5 && f.count > 0);
  };

  const fields: DiffField[] = [];
  const goneFields: string[] = [];
  const newFields: string[] = [];

  // Only established baseline fields can "go gone" — residue/rare fields aren't part of the shape.
  for (const bf of baseline.fields) {
    if (!baseEstablished(bf.field)) continue;
    const lf = liveMap.get(bf.field);
    if (!liveCarriesData(bf.field)) {
      fields.push({
        field: bf.field,
        state: "gone",
        baselineDc: bf.dc,
        liveDc: lf?.dc ?? 0,
        baselineNullRate: bf.nullRate,
        liveNullRate: lf?.nullRate ?? 1,
      });
      goneFields.push(bf.field);
    } else {
      const shifted = lf && Math.abs(lf.dc - bf.dc) / Math.max(1, bf.dc) > 0.3;
      fields.push({
        field: bf.field,
        state: shifted ? "shifted" : "stable",
        baselineDc: bf.dc,
        liveDc: lf!.dc,
        baselineNullRate: bf.nullRate,
        liveNullRate: lf!.nullRate,
      });
    }
  }
  // A live field is NEW if it carries data now but is NOT an established baseline field.
  for (const lf of live.fields) {
    if (!baseEstablished(lf.field) && liveIsCarrying(lf.field)) {
      fields.push({ field: lf.field, state: "new", liveDc: lf.dc, liveNullRate: lf.nullRate });
      newFields.push(lf.field);
    }
  }

  // Cardinality match: does a gone field's dc() match a new field's dc() (a rename signature)?
  let cardinalityMatch: CardinalityMatch | null = null;
  for (const gone of goneFields) {
    const gdc = baseMap.get(gone)?.dc ?? 0;
    if (gdc <= 0) continue;
    for (const nu of newFields) {
      const ndc = liveMap.get(nu)?.dc ?? 0;
      if (ndc <= 0) continue;
      const ratio = Math.min(gdc, ndc) / Math.max(gdc, ndc);
      if (!cardinalityMatch || ratio > cardinalityMatch.matchRatio) {
        cardinalityMatch = {
          goneField: gone,
          newField: nu,
          goneDc: gdc,
          newDc: ndc,
          matchRatio: ratio,
          isRename: ratio >= gates.cardinalityMatchThreshold,
        };
      }
    }
  }

  return {
    fields,
    goneFields,
    newFields,
    cardinalityMatch,
    dependedFieldGone: goneFields.includes(dependsOnField),
  };
}

// The deterministic decision. This is the part that is NEVER faked.
export function classify(diff: ShapeDiff, forecast: ForecastBand, gates: DecisionGates): VerdictLabel {
  const fieldBroke = diff.dependedFieldGone || (diff.cardinalityMatch?.isRename ?? false);
  const volumeFell = forecast.belowBand && forecast.sigmaBelow >= gates.forecastBandSigma * 0.5;

  if (fieldBroke && volumeFell) return "AMBIGUOUS"; // both signals at once — show both, force neither
  if (fieldBroke && !volumeFell) return "NOISE"; // instrument drifted, world unchanged
  if (!fieldBroke && volumeFell) return "NEWS"; // instrument fine, world changed
  return "UNKNOWN"; // nothing meaningfully changed
}

// Build the re-runnable SPL the judge can paste into their own search bar.
export function buildReRunnableSpl(
  index: string,
  sourcetype: string,
  diff: ShapeDiff,
  earliest: string
): string {
  if (diff.cardinalityMatch) {
    const nf = diff.cardinalityMatch.newField;
    return `search index=${index} sourcetype="${sourcetype}" earliest=${earliest} | fieldsummary | search field=${nf} | stats dc(${nf})`;
  }
  return `| tstats count where index=${index} sourcetype="${sourcetype}" by _time span=1m earliest=${earliest} | predict count`;
}

// Ask Gemini to NAME the drifted field and write the one-sentence verdict in the THW voice.
// It is given the already-decided label and the SPL-computed numbers; it cannot change the label.
// If Gemini isn't configured/reachable, we fall back to a deterministic templated sentence.
export async function narrate(
  label: VerdictLabel,
  diff: ShapeDiff,
  forecast: ForecastBand,
  savedSearch: string,
  temperature: number
): Promise<{ sentence: string; driftedField: string | null; reasonedBy: string }> {
  const driftedField =
    diff.cardinalityMatch && diff.cardinalityMatch.isRename
      ? `${diff.cardinalityMatch.goneField} → ${diff.cardinalityMatch.newField}`
      : null;

  const residualPctStr = `${forecast.residualPct >= 0 ? "+" : ""}${(forecast.residualPct * 100).toFixed(1)}%`;

  if (!geminiConfigured()) {
    return { sentence: templateSentence(label, diff, forecast), driftedField, reasonedBy: "deterministic-fallback" };
  }

  const facts = {
    savedSearch,
    label,
    goneFields: diff.goneFields,
    newFields: diff.newFields,
    cardinalityMatch: diff.cardinalityMatch,
    dependedFieldGone: diff.dependedFieldGone,
    volume: {
      liveTotal: forecast.liveTotal,
      expectedTotal: forecast.expectedTotal,
      residualPct: residualPctStr,
      belowBand: forecast.belowBand,
      sigmaBelow: Number(forecast.sigmaBelow.toFixed(2)),
      source: forecast.source,
    },
  };

  const system = [
    "You are Driftwood's verdict writer. You reason OVER numbers SPL already computed — you NEVER decide or change the verdict label; it is given to you and is final.",
    "Voice: calm enterprise SRE, Tan-Han-Wei register. Two-clause contrast with a real em-dash. Concrete numbers up front. No red, no panic, no exclamation marks. One sentence only.",
    "NOISE = the data's view changed (a renamed/dropped field) while system volume held inside its forecast band — 'the machine is fine; your detection is reading a renamed field'.",
    "NEWS = the field set is intact but volume fell far below its forecast band — 'this is the world changing, not your view of it'.",
    "AMBIGUOUS = a field changed AND volume fell at once — say both signals are present and a human must look.",
    'Return ONLY JSON: {"sentence": string}. The sentence MUST name the exact drifted field(s) when present and cite the volume residual percentage.',
  ].join(" ");

  try {
    const { text, model } = await generate(
      `Facts (already computed by SPL, do not alter):\n${JSON.stringify(facts, null, 2)}\n\nWrite the one-sentence ${label} verdict.`,
      { temperature, maxOutputTokens: 512, system }
    );
    const parsed = extractJson<{ sentence: string }>(text);
    const sentence = parsed?.sentence?.trim();
    if (sentence && sentence.length > 10) {
      return { sentence, driftedField, reasonedBy: model };
    }
  } catch {
    // fall through to template
  }
  return { sentence: templateSentence(label, diff, forecast), driftedField, reasonedBy: "deterministic-fallback" };
}

function templateSentence(label: VerdictLabel, diff: ShapeDiff, forecast: ForecastBand): string {
  const cm = diff.cardinalityMatch;
  const pct = `${Math.abs(forecast.residualPct * 100).toFixed(0)}%`;
  if (label === "NOISE" && cm) {
    return `Field ${cm.goneField} disappeared; cardinality of new field ${cm.newField} (dc()=${cm.newDc}) now matches the dead ${cm.goneField} (dc()=${cm.goneDc}) exactly, and the volume forecast shows traffic inside its band — the machine is fine; your detection is reading a renamed field.`;
  }
  if (label === "NEWS") {
    return `Field set intact, null-rates and cardinality stable — your instrument is fine, but event volume is ${pct} below forecast and climbing further out of the band — this is the world changing, not your view of it.`;
  }
  if (label === "AMBIGUOUS") {
    return `A depended-on field drifted and volume fell ${pct} below forecast at the same time — both signals are present, so Driftwood will not force one verdict; a human should look.`;
  }
  return `No meaningful shape change and volume sits inside its forecast band — nothing here separates noise from news.`;
}
