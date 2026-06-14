"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = "seed" | "rename" | "drop" | "reset";

export default function DriftLab() {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | "verdict" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const seed = async () => {
    setBusy("seed");
    const r = await fetch("/api/driftlab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seed" }) });
    const j = await r.json();
    setBusy(null);
    flash(j.ok ? `Seeded ${j.ingested} baseline events + captured fingerprint` : `Error: ${j.error}`);
  };

  const reset = async () => {
    setBusy("reset");
    const r = await fetch("/api/driftlab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
    const j = await r.json();
    setBusy(null);
    flash(j.ok ? "Feed reset to calm" : `Error: ${j.error}`);
  };

  // Run one money-shot arm: seed the BREAK only, then run the LIVE loop, then land on the verdict.
  const runArm = async (arm: "rename" | "drop") => {
    setBusy(arm);
    flash(arm === "rename" ? "Renaming status → http_status in the live feed…" : "Killing ~80% of the traffic…");
    const br = await fetch("/api/driftlab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: arm }) });
    const bj = await br.json();
    if (!bj.ok) {
      setBusy(null);
      flash(`Error seeding break: ${bj.error}`);
      return;
    }
    // Let Splunk make the freshly-ingested break window searchable before the loop reads it.
    flash("Break is live — letting Splunk index it, then running the verdict loop…");
    await new Promise((res) => setTimeout(res, 6000));
    setBusy("verdict");
    const vr = await fetch("/api/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savedSearch: "payments_auth_drop", source: bj.runSource }),
    });
    const vj = await vr.json();
    setBusy(null);
    if (vj.verdict) router.push(`/verdicts?id=${vj.verdict.id}`);
    else flash(`Error: ${vj.error}`);
  };

  return (
    <>
      <div className="head">
        <div>
          <div className="h1">Drift Lab</div>
          <div className="sub">A disposable feed and the same brittle saved search — break it two ways and watch the live verdict flip.</div>
        </div>
        <button className="btn ghost" onClick={reset} disabled={busy !== null}>
          {busy === "reset" ? "Resetting…" : "Reset to calm"}
        </button>
      </div>

      <div className="disclaimer">
        <b>Only the BREAK is seeded — the verdict is computed live from whichever break you chose.</b> The Drift Lab
        sits on top of the real path: same agent, same <span className="mono">tstats</span> /{" "}
        <span className="mono">fieldsummary</span> / <span className="mono">dc()</span> profiling, same forecast oracle.
        A scripted demo cannot fake this — swap in templated data and the two arms collapse into the same answer.
      </div>

      <div className="panel">
        <div className="pt">Step 0 · Calibrate the baseline</div>
        <div className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
          Seeds ~14 days of realistic <span className="mono">cisco:auth</span> traffic into{" "}
          <span className="mono">index=driftwood_demo</span> and captures the shape-fingerprint the live diff compares
          against. Run this once before the demo.
        </div>
        <button className="btn" onClick={seed} disabled={busy !== null}>
          {busy === "seed" ? "Seeding…" : "Seed baseline + fingerprint"}
        </button>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="pt">Arm A · Rename a field</div>
          <div className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
            Renames <span className="mono">status → http_status</span> in the live feed, carrying the same cardinality.
            The brittle search breaks and fires. Volume is untouched.
          </div>
          <button className="btn alt" onClick={() => runArm("rename")} disabled={busy !== null}>
            {busy === "rename" ? "Renaming…" : busy === "verdict" ? "Running loop…" : "Rename status → http_status, then run"}
          </button>
        </div>

        <div className="panel">
          <div className="pt">Arm B · Drop 80% of traffic</div>
          <div className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
            Field set stays intact; volume falls ~80% below its forecast band. The <i>same</i> brittle search fires the{" "}
            <i>same</i> page — but this time it is real.
          </div>
          <button className="btn teal" onClick={() => runArm("drop")} disabled={busy !== null}>
            {busy === "drop" ? "Dropping…" : busy === "verdict" ? "Running loop…" : "Drop 80% of traffic, then run"}
          </button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
