"use client";
import { useEffect, useState } from "react";

interface FieldStat {
  field: string;
  dc: number;
  count: number;
  nullRate: number;
}
interface Fingerprint {
  savedSearch: string;
  index: string;
  sourcetype: string;
  dependsOnField: string;
  baselineWindowDays: number;
  capturedAt: string;
  lastRecalibrated: string;
  confidence: "full" | "low";
  forecastSource: string;
  profile: { fields: FieldStat[]; totalEvents: number };
}

export default function Fingerprints() {
  const [fps, setFps] = useState<Fingerprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/fingerprints")
      .then((r) => r.json())
      .then((d) => {
        setFps(d.fingerprints || []);
        setLoading(false);
      });

  useEffect(() => {
    load();
  }, []);

  const recalibrate = async () => {
    setBusy(true);
    await fetch("/api/fingerprints", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await load();
    setBusy(false);
  };

  return (
    <>
      <div className="head">
        <div>
          <div className="h1">Fingerprint Library</div>
          <div className="sub">Every monitored saved search and its stored shape-fingerprint. Calibration, shown — never silently edited.</div>
        </div>
        <button className="btn ghost" onClick={recalibrate} disabled={busy}>
          {busy ? "Recalibrating…" : "Recalibrate now"}
        </button>
      </div>

      {loading ? (
        <div className="panel">
          <div className="loading">Capturing baseline fingerprints from your 14-day window…</div>
        </div>
      ) : fps.length === 0 ? (
        <div className="panel">
          <div className="loading">No fingerprints yet — seed the Drift Lab so there is baseline data to calibrate from.</div>
        </div>
      ) : (
        <div className="grid2">
          {fps.map((fp) => (
            <div className="panel" key={fp.savedSearch}>
              <div className="pt">
                <span className="mono">{fp.savedSearch}</span>
                <span className={"tag " + (fp.confidence === "full" ? "teal" : "amber")}>
                  {fp.confidence === "full" ? "full confidence" : "low confidence"}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                sourcetype <span className="mono">{fp.sourcetype}</span> · depends on{" "}
                <span className="mono">{fp.dependsOnField}</span> · baseline <span className="mono">{fp.baselineWindowDays}d</span> ·{" "}
                {fp.forecastSource}
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
                  {fp.profile.fields.map((f) => (
                    <tr key={f.field}>
                      <td className="mono">{f.field}</td>
                      <td className="mono">{f.dc.toLocaleString()}</td>
                      <td className="mono">{(f.nullRate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                last recalibrated {new Date(fp.lastRecalibrated).toLocaleString()} · {fp.profile.totalEvents.toLocaleString()} events in baseline
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
