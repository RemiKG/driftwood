// Server-side runtime config. Connection + gates live here; secrets stay in env, never in client code.
// The Drift Lab and saved-search registry are also defined here so the loop and the UI agree.

import { DEFAULT_GATES, type DecisionGates, type Fingerprint } from "./types";

export const DEMO_INDEX = process.env.DRIFTWOOD_DEMO_INDEX || "driftwood_demo";
export const VERDICT_INDEX = process.env.DRIFTWOOD_VERDICT_INDEX || "driftwood_verdicts";
export const DRIFTLAB_SOURCETYPE = "cisco:auth";
export const DRIFTLAB_SOURCE = "driftlab:payments";
export const BASELINE_WINDOW_DAYS = Number(process.env.BASELINE_WINDOW_DAYS || 14);

// The alert window the loop profiles. The Drift Lab seeds the break into exactly this window and the
// baseline seed deliberately leaves it empty, so the live diff reflects only the break the judge chose.
export const ALERT_WINDOW_MIN = Number(process.env.ALERT_WINDOW_MIN || 12);
export const ALERT_EARLIEST = `-${ALERT_WINDOW_MIN}m`;
export const BASELINE_RATE_PER_MIN = 14;

// The brittle saved searches Driftwood monitors. payments_auth_drop is the Drift Lab's live arm.
export interface SavedSearchDef {
  name: string;
  index: string;
  sourcetype: string;
  source?: string;
  dependsOnField: string; // the field the brittle search reads — the one that can drift
  spl: string; // the actual brittle detection SPL
  isLab: boolean;
}

export const SAVED_SEARCHES: SavedSearchDef[] = [
  {
    name: "payments_auth_drop",
    index: DEMO_INDEX,
    sourcetype: DRIFTLAB_SOURCETYPE,
    source: DRIFTLAB_SOURCE,
    dependsOnField: "status",
    spl: `search index=${DEMO_INDEX} sourcetype="${DRIFTLAB_SOURCETYPE}" status>=500 | stats count`,
    isLab: true,
  },
];

let gates: DecisionGates = { ...DEFAULT_GATES };
export function getGates(): DecisionGates {
  return gates;
}
export function setGates(next: Partial<DecisionGates>): DecisionGates {
  gates = { ...gates, ...next };
  return gates;
}

// In-process fingerprint store (the baseline shape per saved search). Persisted to Splunk on capture;
// re-read from index=driftwood_verdicts annotations is possible but the live capture is the source.
const fingerprints = new Map<string, Fingerprint>();
export function putFingerprint(fp: Fingerprint) {
  fingerprints.set(fp.savedSearch, fp);
}
export function getFingerprint(name: string): Fingerprint | undefined {
  return fingerprints.get(name);
}
export function allFingerprints(): Fingerprint[] {
  return [...fingerprints.values()];
}

// Agent settings the UI can tune.
export const agentSettings = {
  geminiModel: process.env.GEMINI_MODEL || "gemini-flash-latest",
  temperature: 0.1,
  forecastSource: (process.env.HOSTED_MODEL_URL ? "hosted-model" : "spl-predict") as "hosted-model" | "spl-predict",
};
