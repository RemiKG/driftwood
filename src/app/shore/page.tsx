"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Alert {
  time: string;
  eventId: string;
  savedSearch: string;
  verdict: string;
  driftedField: string | null;
  timeToVerdictMs: number;
}
interface Kpis {
  noisePagesCaughtToday: number;
  medianTimeToVerdictSec: number;
  fieldsDriftedThisWeek: number;
  verdictsBackedBySpl: number;
}

export default function Shore() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [status, setStatus] = useState<{ searchJobs: boolean; mcpApp7931: boolean; hostedModels: boolean; baselineWindowDays: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/alerts").then((r) => r.json()),
      fetch("/api/splunk/test").then((r) => r.json()),
    ]).then(([a, s]) => {
      setAlerts(a.alerts || []);
      setKpis(a.kpis);
      setStatus(s);
      setLoading(false);
    });
  }, []);

  return (
    <>
      <div className="head">
        <div>
          <div className="h1">The Shore</div>
          <div className="sub">Noise is when your view of the world changed. News is when the world did.</div>
        </div>
        <span className="pill">
          <span className={"d" + (status?.mcpApp7931 ? "" : " amber")} />
          {status?.mcpApp7931 ? "MCP connected" : "REST proxy"} · baseline <span className="mono">&nbsp;{status?.baselineWindowDays ?? 14}d</span>
        </span>
      </div>

      <div className="kpis">
        <Kpi k="Noise pages caught today" v={kpis ? String(kpis.noisePagesCaughtToday) : "—"} delta="● live" />
        <Kpi k="Median time-to-verdict" v={kpis ? `${kpis.medianTimeToVerdictSec}s` : "—"} delta="● SPL-timed" />
        <Kpi k="Fields drifted this week" v={kpis ? String(kpis.fieldsDriftedThisWeek) : "—"} delta="● measured" />
        <Kpi k="Verdicts backed by SPL" v={kpis ? `${kpis.verdictsBackedBySpl}%` : "—"} delta="●" />
      </div>

      <div className="panel">
        <div className="pt">
          Recent alerts
          <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
            read from <span className="mono">index=driftwood_verdicts</span>
          </span>
        </div>
        {loading ? (
          <div className="loading">Reading verdict annotations from Splunk…</div>
        ) : alerts.length === 0 ? (
          <div className="loading">
            No verdicts yet. Open <b>Drift Lab</b>, seed the baseline, then break the feed — every verdict you
            run is written back here as a real Splunk event.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Saved search</th>
                <th>Verdict</th>
                <th>Drifted field</th>
                <th>To verdict</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.eventId} style={{ cursor: "pointer" }} onClick={() => router.push(`/verdicts?id=${a.eventId}`)}>
                  <td className="mono">{a.savedSearch}</td>
                  <td>
                    <span className={"tag " + (a.verdict === "NOISE" ? "amber" : a.verdict === "NEWS" ? "teal" : "ink")}>
                      {a.verdict}
                    </span>
                  </td>
                  <td className="mono">{a.driftedField || "—"}</td>
                  <td className="mono">{(a.timeToVerdictMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Kpi({ k, v, delta }: { k: string; v: string; delta: string }) {
  return (
    <div className="kpi">
      <div className="k">{k}</div>
      <div className="v mono">{v}</div>
      <div className="delta">{delta}</div>
    </div>
  );
}
