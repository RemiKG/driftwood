"use client";
import { useState } from "react";
import ForecastBand from "./ForecastBand";

export interface VerdictData {
  id: string;
  savedSearch: string;
  label: "NOISE" | "NEWS" | "AMBIGUOUS" | "UNKNOWN";
  driftedField: string | null;
  sentence: string;
  reUnnableSpl: string;
  residualPct: number;
  cardinalityDelta: string;
  nullRateShift: string;
  timeToVerdictMs: number;
  forecastSource: string;
  reasonedBy: string;
  writtenEventId: string | null;
  forecast?: {
    points: { time: string; predicted: number; lower: number; upper: number }[];
    live: { time: string; volume: number }[];
    belowBand: boolean;
  };
}

const HEADER: Record<string, { cls: string; note: string }> = {
  NOISE: { cls: "noise", note: "not an outage" },
  NEWS: { cls: "news", note: "real incident" },
  AMBIGUOUS: { cls: "ambiguous", note: "both signals — a human should look" },
  UNKNOWN: { cls: "ambiguous", note: "nothing separates noise from news" },
};

export default function VerdictCard({ v }: { v: VerdictData }) {
  const [copied, setCopied] = useState(false);
  const h = HEADER[v.label] || HEADER.UNKNOWN;
  const isNoise = v.label === "NOISE";
  const residual = `${v.residualPct >= 0 ? "+" : ""}${(v.residualPct * 100).toFixed(1)}%`;

  const copy = async () => {
    await navigator.clipboard.writeText(v.reUnnableSpl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <div className="head">
        <div>
          <div className="h1">Verdict — {v.savedSearch}</div>
          <div className="sub">
            Same brittle search.{" "}
            {isNoise ? "The judge renamed a field." : v.label === "NEWS" ? "The judge killed traffic." : "Live decision."}
          </div>
        </div>
        <span className={"verdicttag " + h.cls}>
          {v.label} · {h.note}
        </span>
      </div>

      <div className="panel">
        <div className="pt">The verdict</div>
        <div style={{ fontSize: 17, lineHeight: 1.6 }}>{v.sentence}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          reasoned by <span className="mono">{v.reasonedBy}</span> · decision gated on the live shape-diff + forecast
          residual (never faked)
        </div>
      </div>

      <div className="panel">
        <div className="facts">
          <div className="fact">
            <div className="fl">Drifted field</div>
            <div className="fv mono">{v.driftedField || "none"}</div>
            <div className={"fnote " + (v.driftedField ? "amber" : "teal")}>
              {v.driftedField ? v.cardinalityDelta : "set intact"}
            </div>
          </div>
          <div className="fact">
            <div className="fl">Volume residual</div>
            <div className="fv mono">{residual}</div>
            <div className={"fnote " + (v.forecast?.belowBand ? "teal" : "amber")}>
              {v.forecast?.belowBand ? "below band" : "in-band"}
            </div>
          </div>
          <div className="fact">
            <div className="fl">Null-rate shift</div>
            <div className="fv mono">{v.nullRateShift}</div>
            <div className="fnote muted">stable</div>
          </div>
          <div className="fact">
            <div className="fl">Time to verdict</div>
            <div className="fv mono">{(v.timeToVerdictMs / 1000).toFixed(1)}s</div>
            <div className="fnote muted">{v.forecastSource}</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="pt">
          Re-runnable SPL — paste it, check it
          <button className="btn alt" onClick={copy}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <div className="code mono">{v.reUnnableSpl}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          Written to <span className="mono">index=driftwood_verdicts</span> · event{" "}
          <span className="mono">{v.writtenEventId || "—"}</span>
        </div>
      </div>

      {v.forecast && (
        <div className="panel">
          <div className="pt">
            Volume forecast band —{" "}
            {v.forecast.belowBand ? "live line fell out the bottom of the corridor" : "traffic held inside the corridor"}
          </div>
          <ForecastBand points={v.forecast.points} live={v.forecast.live} />
        </div>
      )}
    </>
  );
}
