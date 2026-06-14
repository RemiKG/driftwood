"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ForecastBand from "@/components/ForecastBand";

interface FieldStat {
  field: string;
  dc: number;
  count: number;
  nullRate: number;
}
interface DiffField {
  field: string;
  state: "stable" | "gone" | "new" | "shifted";
  baselineDc?: number;
  liveDc?: number;
  baselineNullRate?: number;
  liveNullRate?: number;
}
interface ProfileResp {
  savedSearch: string;
  sourcetype: string;
  window: { earliest: string; latest: string };
  baseline: { fields: FieldStat[]; totalEvents: number };
  live: { fields: FieldStat[]; totalEvents: number };
  diff: {
    fields: DiffField[];
    goneFields: string[];
    newFields: string[];
    cardinalityMatch: { goneField: string; newField: string; goneDc: number; newDc: number; matchRatio: number; isRename: boolean } | null;
  };
  forecast: {
    points: { time: string; predicted: number; lower: number; upper: number }[];
    live: { time: string; volume: number }[];
    source: string;
    liveTotal: number;
    expectedTotal: number;
    residualPct: number;
    belowBand: boolean;
  };
  error?: string;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function ShapeDiffInner() {
  const params = useSearchParams();
  const savedSearch = params.get("savedSearch") || "payments_auth_drop";
  const earliest = params.get("earliest") || "-12m";
  const [data, setData] = useState<ProfileResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/profile?savedSearch=${encodeURIComponent(savedSearch)}&earliest=${encodeURIComponent(earliest)}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [savedSearch, earliest]);

  const cm = data?.diff.cardinalityMatch;
  const goneSet = new Set(data?.diff.goneFields || []);
  const newSet = new Set(data?.diff.newFields || []);

  const bandHeld = data ? !data.forecast.belowBand : true;

  return (
    <>
      <div className="head">
        <div>
          <div className="h1">Shape Diff — {savedSearch}</div>
          <div className="sub">
            Baseline fingerprint vs live profile · alert window <span className="mono">{earliest} → now</span>
          </div>
        </div>
        {data && (
          <span className="pill">
            sourcetype <span className="mono">&nbsp;{data.sourcetype}</span>
          </span>
        )}
      </div>

      {loading ? (
        <div className="panel">
          <div className="loading">Profiling live shape over the 443 proxy — tstats + fieldsummary + dc()…</div>
        </div>
      ) : data?.error ? (
        <div className="panel">
          <div className="loading">Error: {data.error}</div>
        </div>
      ) : data ? (
        <>
          <div className="cols">
            <div className="panel">
              <div className="pt">
                Baseline fingerprint <span className="mono muted">(14d)</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>dc()</th>
                    <th>null %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.baseline.fields.map((f) => (
                    <tr key={f.field}>
                      <td className="mono">{f.field}</td>
                      <td className="mono">{f.dc.toLocaleString()}</td>
                      <td className="mono">{pct(f.nullRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel">
              <div className="pt">
                Live profile <span className="mono muted">(now)</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>dc()</th>
                    <th>null %</th>
                  </tr>
                </thead>
                <tbody>
                  {/* gone fields first (greyed), then new (amber), then stable */}
                  {data.baseline.fields
                    .filter((f) => goneSet.has(f.field))
                    .map((f) => (
                      <tr key={"g" + f.field} className="fieldrow gone">
                        <td className="mono">
                          <span className="tag ink">{f.field} — gone</span>
                        </td>
                        <td className="mono">0</td>
                        <td className="mono">100%</td>
                      </tr>
                    ))}
                  {data.live.fields
                    .filter((f) => newSet.has(f.field))
                    .map((f) => (
                      <tr key={"n" + f.field} className="fieldrow new">
                        <td className="mono">
                          <span className="tag amber">{f.field} — new</span>
                        </td>
                        <td className="mono">{f.dc.toLocaleString()}</td>
                        <td className="mono">{pct(f.nullRate)}</td>
                      </tr>
                    ))}
                  {data.live.fields
                    .filter((f) => !newSet.has(f.field))
                    .map((f) => (
                      <tr key={f.field}>
                        <td className="mono">{f.field}</td>
                        <td className="mono">{f.dc.toLocaleString()}</td>
                        <td className="mono">{pct(f.nullRate)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="pt">
              {cm ? (
                <>
                  Cardinality match ·{" "}
                  <span className="mono">
                    {cm.goneField} (dc {cm.goneDc}) {cm.isRename ? "≡" : "≠"} {cm.newField} (dc {cm.newDc})
                  </span>{" "}
                  — {cm.isRename ? "a rename, not a wreck" : "no exact match"}
                </>
              ) : (
                <>Field set intact — no field disappeared in this window</>
              )}
            </div>
            <div className="code mono">
              <span className="kw">| tstats</span> count <span className="kw">by</span> index, sourcetype |{" "}
              <span className="fn">fieldsummary</span> | <span className="fn">stats</span>{" "}
              dc({cm ? cm.newField : data.live.fields[0]?.field || "field"})
            </div>
          </div>

          <div className="panel">
            <div className="pt">
              Volume forecast band —{" "}
              {bandHeld ? "traffic held inside the teal corridor" : "live line fell out the bottom of the corridor"}
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                live {data.forecast.liveTotal} vs forecast {data.forecast.expectedTotal} ({pct(data.forecast.residualPct)}) ·{" "}
                {data.forecast.source}
              </span>
            </div>
            <ForecastBand points={data.forecast.points} live={data.forecast.live} />
          </div>
        </>
      ) : null}
    </>
  );
}

export default function ShapeDiff() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <ShapeDiffInner />
    </Suspense>
  );
}
