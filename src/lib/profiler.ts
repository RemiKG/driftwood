// The real signal engine. Profiles the SHAPE of a sourcetype's data over the 443 proxy:
//   - field set + each field's cardinality dc() + null-rate  (fieldsummary / stats dc())
//   - per-sourcetype event volume                            (tstats count by _time)
//   - a forecast band for the volume                          (SPL-native | predict, the honest fallback;
//                                                               or a Hosted Model endpoint if one is wired)
// Every number returned here was computed by SPL on the user's real data. Nothing is drawn by hand.

import { SplunkClient } from "./splunk";
import type { FieldStat, ShapeProfile, ForecastBand, VolumePoint } from "./types";

// Fields Splunk adds automatically that are not part of the data's real shape.
const INTERNAL_FIELDS = new Set([
  "date_hour", "date_mday", "date_minute", "date_month", "date_second", "date_wday",
  "date_year", "date_zone", "eventtype", "host", "index", "linecount", "punct",
  "source", "sourcetype", "splunk_server", "splunk_server_group", "tag", "tag::eventtype",
  "timeendpos", "timestartpos", "_time", "_raw", "_bkt", "_cd", "_indextime", "_serial",
  "_si", "_sourcetype", "_subsecond",
]);

function isRealField(f: string): boolean {
  return !INTERNAL_FIELDS.has(f) && !f.startsWith("tag::") && !f.startsWith("date_");
}

export interface ProfileQuery {
  index: string;
  sourcetype: string;
  earliest: string;
  latest: string;
  source?: string; // optional source filter (used to scope a Drift Lab run cleanly)
}

function srcClause(source?: string): string {
  return source ? ` source="${source}"` : "";
}

// Profile the field shape (set + dc + null-rate) over a window. Real fieldsummary on real data.
export async function profileShape(sp: SplunkClient, q: ProfileQuery): Promise<ShapeProfile> {
  const base = `search index=${q.index} sourcetype="${q.sourcetype}"${srcClause(q.source)}`;
  // total events in the window (the denominator for null-rate)
  const totalRows = await sp.search(`${base} | stats count`, { earliest: q.earliest, latest: q.latest });
