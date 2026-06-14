# Driftwood.

> **Your alert fired because the data changed shape — not because the system broke. Driftwood tells noise from news.**

Observability track · Splunk Agentic Ops Hackathon.

Half the pages that wake an on-call SRE at 3am are not outages — they're **schema drift**: an upstream team renamed a field, a sourcetype's volume halved, a brittle saved search broke, and the worst 20 minutes of the night get spent *proving the alert lied*. Driftwood doesn't watch your systems; it watches **the data feeding your detections**, and answers the one question that matters before you escalate or go back to sleep.

> **Noise is when your view of the world changed. News is when the world did.**

---

## What it does

For each monitored saved search, Driftwood stores a **shape-fingerprint** — the field set, each field's cardinality (`dc()`) and null-rate, and the forecasted event-volume per sourcetype. When an alert fires, a Gemini agent re-profiles the alert's own window over the Splunk 443 REST proxy and **diffs it against the stored fingerprint and against a volume forecast**, then classifies the page:

- **NOISE** (`DATA-SHAPE-CHANGED`) — a depended-on field disappeared and its cardinality migrated to a newly-appeared field, **but volume sits inside its forecast band**. Your instrument drifted; the world didn't.
- **NEWS** (`SYSTEM-CHANGED`) — the field set is intact, nulls and cardinality stable, **but volume fell far below its band**. A real incident.

The verdict names the **exact drifted field** (`status → http_status`, `dc()` match), ships the **re-runnable SPL** that produced it, and is written back into Splunk as a structured annotation in `index=driftwood_verdicts` so the call is auditable.

### The money shot

Same brittle saved search, **opposite verdict by the judge's choice** — and a scripted demo cannot fake it, because the only thing that separates "a field was renamed" from "traffic died" is the live field-set/cardinality diff against the live volume residual.

- **Arm A — rename** (`status → http_status` in the live feed): the search breaks → Driftwood returns **NOISE**, names the drifted field, shows its cardinality migrated to the new field (`dc()` match), volume inside its forecast band → *"go back to sleep."*
- **Arm B — drop 80% of traffic**: the *same* search fires the *same* page → Driftwood returns **NEWS**, field shape intact but volume far below its forecast band.

Both arms run through the identical agent + profiling SPL + forecast oracle. **Only the break is seeded — the verdict is always computed live.**

---

## Architecture

```
Next.js (App Router, React 19) — the calm cream/ink console
  │
  ├─ src/app/*           screens: The Shore · Shape Diff · Verdicts · Fingerprints · Drift Lab · Settings
  ├─ src/app/api/*       server routes (Node runtime): profile · verdict · alerts · fingerprints · driftlab · settings · splunk/test
  │
