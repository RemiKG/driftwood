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
