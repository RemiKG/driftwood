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
