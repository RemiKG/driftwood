// Shared shape types for the Driftwood loop. Every number here is computed by SPL, never invented.

export interface FieldStat {
  field: string;
  dc: number; // distinct_count — cardinality
  count: number; // events the field appeared in
  nullRate: number; // 0..1 — fraction of events where the field was absent
}

export interface VolumePoint {
  time: string; // ISO
  volume: number;
}

export interface ForecastBand {
  // Per-point forecast over the alert window: predicted mean + 95% band, from the trailing baseline.
  points: { time: string; predicted: number; lower: number; upper: number }[];
  // The live volume observed in the alert window, aligned to the same points where possible.
  live: VolumePoint[];
  source: "hosted-model" | "spl-predict"; // honest provenance of the band
  // Summary residual used by the verdict gate.
  liveTotal: number;
  expectedTotal: number;
  residualPct: number; // (live - expected) / expected, negative = below forecast
  belowBand: boolean; // live total fell below the lower band sum
  sigmaBelow: number; // how many band-sigmas below predicted (rough)
}

export interface ShapeProfile {
  index: string;
  sourcetype: string;
  totalEvents: number;
  fields: FieldStat[];
  window: { earliest: string; latest: string };
}

export interface Fingerprint {
  savedSearch: string;
  index: string;
  sourcetype: string;
  // The field the brittle saved search depends on (the one that can "drift").
  dependsOnField: string;
  baselineWindowDays: number;
  capturedAt: string;
  lastRecalibrated: string;
  confidence: "full" | "low"; // low when < minHistoryDays of history
  profile: ShapeProfile;
  // Stored forecast band summary so the Fingerprint Library can show the corridor.
  forecastSource: ForecastBand["source"];
}

export interface DiffField {
  field: string;
  state: "stable" | "gone" | "new" | "shifted";
  baselineDc?: number;
  liveDc?: number;
  baselineNullRate?: number;
  liveNullRate?: number;
}

export interface CardinalityMatch {
  goneField: string;
  newField: string;
  goneDc: number;
  newDc: number;
  matchRatio: number; // min/max of the two dc() values, 1.0 = exact
  isRename: boolean; // matchRatio >= cardinalityMatchThreshold
}

export interface ShapeDiff {
  fields: DiffField[];
  goneFields: string[];
  newFields: string[];
  cardinalityMatch: CardinalityMatch | null;
  dependedFieldGone: boolean;
}

export type VerdictLabel = "NOISE" | "NEWS" | "AMBIGUOUS" | "UNKNOWN";

export interface Verdict {
  id: string;
  savedSearch: string;
  index: string;
  sourcetype: string;
  label: VerdictLabel;
  driftedField: string | null; // "status → http_status" or null
  sentence: string; // one-sentence THW-voice verdict
  reUnnableSpl: string;
  forecast: ForecastBand;
  diff: ShapeDiff;
  residualPct: number;
  cardinalityDelta: string; // e.g. "dc 17 ≡ 17"
  nullRateShift: string;
  timeToVerdictMs: number;
  forecastSource: ForecastBand["source"];
  reasonedBy: string; // gemini model id, or "deterministic-fallback"
  writtenEventId: string | null; // event id written to index=driftwood_verdicts
  runSource: string | null; // the source the live alert window was scoped to (Drift Lab run)
  createdAt: string;
}

export interface DecisionGates {
  cardinalityMatchThreshold: number; // e.g. 0.98 — how exact a dc() match counts as a rename
  forecastBandSigma: number; // e.g. 2.0 — how far below the band counts as news
  minHistoryDays: number; // below this a verdict is low-confidence
}

export const DEFAULT_GATES: DecisionGates = {
  cardinalityMatchThreshold: 0.98,
  forecastBandSigma: 2.0,
  minHistoryDays: 14,
};
