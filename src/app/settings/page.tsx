"use client";
import { useEffect, useState } from "react";

interface Gates {
  cardinalityMatchThreshold: number;
  forecastBandSigma: number;
  minHistoryDays: number;
}
interface TestResult {
  splunkUrl: string | null;
  searchJobs: boolean;
  indexes: string[];
  mcpApp7931: boolean;
  hostedModels: boolean;
  gemini: boolean;
  baselineWindowDays: number;
}

export default function Settings() {
  const [gates, setGates] = useState<Gates | null>(null);
  const [agent, setAgent] = useState<{ geminiModel: string; temperature: number; forecastSource: string } | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [indexes, setIndexes] = useState<{ demoIndex: string; verdictIndex: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setGates(d.gates);
        setAgent(d.agent);
        setIndexes({ demoIndex: d.demoIndex, verdictIndex: d.verdictIndex });
      });
  }, []);

  const runTest = async () => {
    setTesting(true);
    const r = await fetch("/api/splunk/test");
    setTest(await r.json());
    setTesting(false);
  };

  const save = async () => {
    if (!gates) return;
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...gates, temperature: agent?.temperature }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const dot = (ok: boolean) => <span className={"d" + (ok ? "" : " off")} />;

  return (
    <>
      <div className="head">
        <div>
          <div className="h1">Settings</div>
          <div className="sub">Connect once. Tune the gates. The fallback is a switch, not a hidden degrade.</div>
        </div>
        <span className="pill">
          all over the <span className="mono">&nbsp;443&nbsp;</span> proxy
        </span>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="pt">Connect</div>
          <div className="srow">
            <span className="sl">Splunk host</span>
            <span className="mono">{test?.splunkUrl ? new URL(test.splunkUrl).host : "from env"}</span>
          </div>
          <div className="srow">
            <span className="sl">Session token</span>
            <span className="mono">•••••••• {test?.searchJobs ? "✓" : ""}</span>
          </div>
          <div className="srow">
            <span className="sl">MCP endpoint</span>
            <span className="mono">
              /services/mcp{" "}
              {test ? (
                <span className={"tag " + (test.mcpApp7931 ? "teal" : "amber")}>
                  app 7931 {test.mcpApp7931 ? "✓" : "REST fallback"}
                </span>
              ) : null}
            </span>
          </div>
          <div className="srow">
            <span className="sl">Monitored indexes</span>
            <span className="mono">{indexes ? `${indexes.demoIndex} · ${indexes.verdictIndex}` : "—"}</span>
          </div>
        </div>

        <div className="panel">
          <div className="pt">Forecast oracle</div>
          <div className="srow">
            <span className="sl">Source</span>
            <span className={"tag " + (agent?.forecastSource === "hosted-model" ? "teal" : "amber")}>
              {agent?.forecastSource === "hosted-model" ? "Cisco Deep Time Series" : "SPL predict (fallback)"}
            </span>
          </div>
          <div className="srow">
            <span className="sl">Fallback</span>
            <span className="mono">predict / anomalydetection</span>
          </div>
          <div className="srow">
            <span className="sl">Granularity</span>
            <span className="mono">1m · 15m horizon</span>
          </div>
          <div className="srow">
            <span className="sl">Gemini reasoning</span>
            <span className="mono">{test ? (test.gemini ? "Vertex ✓" : "off") : agent?.geminiModel}</span>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="pt">Decision gates</div>
          {gates && (
            <>
              <div className="srow">
                <span className="sl">Cardinality-match threshold</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={gates.cardinalityMatchThreshold}
                  onChange={(e) => setGates({ ...gates, cardinalityMatchThreshold: Number(e.target.value) })}
                />
              </div>
              <div className="srow">
                <span className="sl">Forecast-band sigma (news)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={gates.forecastBandSigma}
                  onChange={(e) => setGates({ ...gates, forecastBandSigma: Number(e.target.value) })}
                />
              </div>
              <div className="srow">
                <span className="sl">Min history before trusted (days)</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={gates.minHistoryDays}
                  onChange={(e) => setGates({ ...gates, minHistoryDays: Number(e.target.value) })}
                />
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <div className="pt">Baseline &amp; agent</div>
          <div className="srow">
            <span className="sl">Baseline window</span>
            <span className="mono">rolling {test?.baselineWindowDays ?? 14}d</span>
          </div>
          <div className="srow">
            <span className="sl">Recalibration</span>
            <span className="mono">on-demand</span>
          </div>
          <div className="srow">
            <span className="sl">Gemini model · temp</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={agent?.temperature ?? 0.1}
              onChange={(e) => agent && setAgent({ ...agent, temperature: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="pt">Gemini reasons over numbers SPL computed — it never decides the numbers.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <button className="btn" onClick={runTest} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button className="btn alt" onClick={save}>
            {saved ? "Saved ✓" : "Save gates"}
          </button>
        </div>
        {test && (
          <div className="muted" style={{ fontSize: 13, marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
            <span>{dot(test.searchJobs)} search jobs</span>
            <span>{dot(test.mcpApp7931)} MCP app 7931</span>
            <span>{dot(test.hostedModels)} Hosted Models</span>
            <span>{dot(test.gemini)} Gemini (Vertex)</span>
            <span className="mono">{test.indexes.length} indexes reachable</span>
          </div>
        )}
      </div>
    </>
  );
}
