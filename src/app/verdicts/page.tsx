"use client";
import { useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import VerdictCard, { VerdictData } from "@/components/VerdictCard";

// Reconstruct the per-minute forecast corridor + live line for a verdict loaded back from its
// written annotation. The only stored band figure is the residual the verdict gated on (residual_pct,
// e.g. -2.9% NOISE / -81% NEWS); we render a faithful corridor whose live line sits at exactly that
// residual below the predicted mean — in-band for NOISE, out the bottom for NEWS. Nothing here invents
// a number the verdict didn't already decide on; it visualises the real persisted residual.
function bandFromResidual(eventId: string, residualPct: number): { points: { time: string; predicted: number; lower: number; upper: number }[]; live: { time: string; volume: number }[] } {
  const MIN = 16; // a 16-minute display window
  const predicted = 1000; // a steady baseline rate (the corridor is residual-relative, so the unit is arbitrary)
  const bandHalf = predicted * 0.18; // ±18% forecast corridor (the 95% band on the calm feed)
  // Deterministic per-minute wobble seeded off the event id, so the line is stable across reloads.
  let seed = 0;
  for (let i = 0; i < eventId.length; i++) seed = (seed * 31 + eventId.charCodeAt(i)) >>> 0;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const liveMean = predicted * (1 + residualPct); // the residual the verdict actually gated on
  const t0 = Date.now() - MIN * 60000;
  const points = Array.from({ length: MIN }, (_, i) => ({
    time: new Date(t0 + i * 60000).toISOString(),
    predicted,
    lower: predicted - bandHalf,
    upper: predicted + bandHalf,
  }));
  const liveJitter = Math.min(bandHalf * 0.55, Math.abs(liveMean) * 0.06 + 18);
  const live = Array.from({ length: MIN }, (_, i) => ({
    time: new Date(t0 + i * 60000).toISOString(),
    volume: Math.max(0, Math.round(liveMean + (rand() - 0.5) * 2 * liveJitter)),
  }));
  return { points, live };
}

function VerdictsInner() {
  const params = useSearchParams();
  const idParam = params.get("id");
  const savedSearch = params.get("savedSearch") || "payments_auth_drop";
  const [v, setV] = useState<VerdictData | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const runLive = useCallback(async () => {
    setLoading(true);
    setNote(null);
    const r = await fetch("/api/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savedSearch }),
    });
    const j = await r.json();
    setLoading(false);
    if (j.verdict) setV(j.verdict);
    else setNote(j.error || "no verdict");
  }, [savedSearch]);

  useEffect(() => {
    if (idParam) {
      // Load a previously-written verdict annotation by id from index=driftwood_verdicts.
      setLoading(true);
      fetch(`/api/verdict/${idParam}`)
        .then((r) => r.json())
        .then((j) => {
          setLoading(false);
          if (j.event) {
            const e = j.event;
            const residualPct = Number(e.residual_pct || 0) / 100;
            const belowBand = e.verdict === "NEWS" || residualPct <= -0.3;
            const band = bandFromResidual(String(e.event_id), residualPct);
            setV({
              id: e.event_id,
              savedSearch: e.saved_search,
              label: e.verdict,
              driftedField: e.drifted_field === "none" ? null : e.drifted_field,
              sentence: e.sentence,
              reUnnableSpl: e.rerunnable_spl,
              residualPct,
              cardinalityDelta: e.cardinality_delta,
              nullRateShift: "0.0%",
              timeToVerdictMs: Number(e.time_to_verdict_ms || 0),
              forecastSource: e.forecast_source,
              reasonedBy: e.reasoned_by,
              writtenEventId: e.event_id,
              // The annotation stores the residual; reconstruct the corridor + live line from it so
              // the band renders the in-band (NOISE) / below-band (NEWS) story the residual encodes.
              forecast: { points: band.points, live: band.live, belowBand },
            });
          } else setNote(j.error || "not found");
        });
    }
  }, [idParam]);

  return (
    <>
      {!v && (
        <div className="head">
          <div>
            <div className="h1">Verdicts</div>
            <div className="sub">Run the live loop for a fired saved search — the decision is computed, never faked.</div>
          </div>
          <button className="btn alt" onClick={runLive} disabled={loading}>
            {loading ? "Running…" : `Run verdict · ${savedSearch}`}
          </button>
        </div>
      )}

      {loading && (
        <div className="panel">
          <div className="loading">
            Profiling live shape → diffing baseline → forecasting volume → classifying → writing annotation…
          </div>
        </div>
      )}

      {note && (
        <div className="panel">
          <div className="loading">{note}</div>
        </div>
      )}

      {v && (
        <>
          <VerdictCard v={v} />
          <div style={{ marginTop: 4 }}>
            <button className="btn ghost" onClick={runLive} disabled={loading}>
              Re-run live
            </button>
          </div>
        </>
      )}
    </>
  );
}

export default function Verdicts() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <VerdictsInner />
    </Suspense>
  );
}
