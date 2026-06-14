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
  └─ src/lib/            the engine (server-only)
       splunk.ts         443 web-REST-proxy client (session login → /splunkd/__raw/services/...) — adapted from the proven _tools client
       profiler.ts       REAL signal engine: fieldsummary + stats dc() (field shape) · tstats (volume) · | predict (forecast band)
       verdict.ts        deterministic NOISE/NEWS gate + the live-vs-baseline shape diff + Gemini narration (names the field)
       gemini.ts         Google Gemini via Vertex AI — mints its own OAuth token from the SA key (no gcloud at runtime)
       driftlab.ts       the demo feed: seeds ONLY the break (rename / drop), tagged per-run so the verdict is never seeded
       loop.ts           orchestrates: profile → diff → forecast → classify → narrate → write annotation
       config.ts         saved-search registry, indexes, decision gates, agent settings

mcp/server.mjs           a tiny in-repo MCP server (JSON-RPC over stdio) wrapping the Splunk client as read tools
scripts/seed.mjs         CLI baseline seeder
```

**The loop, end to end:**
`saved search alerts → Gemini reads the alert window over the 443 proxy → profiles live shape (tstats volume + fieldsummary + dc()) → diffs vs the stored fingerprint → forecasts expected volume → field gone BUT volume in-band? NOISE (name the drifted field) : field set intact BUT volume below band? NEWS → write the verdict annotation to index=driftwood_verdicts → render.`

### The decision is never faked

The noise/news label is a **deterministic gate** (`classify()` in `verdict.ts`) over two SPL-computed measurements: the field-set/cardinality diff and the volume forecast residual. Gemini reasons *over* those numbers to **name the drifted field and write the one-sentence verdict** — it can never change the label. If Gemini is unreachable, a deterministic templated sentence is used and the verdict is identical.

---

## Real integrations (no mock on the core)

- **Splunk Cloud 10.4** over the **443 web REST proxy** (`your-stack.splunkcloud.com`) — session login, then `/services/search/jobs` (SPL), `/services/receivers/simple` (ingest), `/services/data/indexes` (ensure index). No 8089, no ACS. Every `tstats` / `fieldsummary` / `dc()` / `predict` runs on real data.
- **Google Gemini via Vertex AI** (`rapid-agents-5166`, location `global`, `gemini-flash-latest`) — the agent's reasoning brain. The app mints an OAuth token from the service-account key with `google-auth-library`; on Cloud Run, bind the SA instead of shipping the key.
- **Persisted in your Splunk:** the verdict annotations (real events in `index=driftwood_verdicts`) and the seeded demo data (`index=driftwood_demo`).

### Honest fallbacks (seamed behind env checks)

The trial does not have the optional Splunk AI primitives installed. Each is seamed so it activates when present and falls back honestly — the mechanic, the money shot, and the verdict are **unchanged**, Driftwood just earns one fewer bonus. A `_NEEDS <thing>.md` note sits outside this repo for each.

| Primitive | When present | Honest fallback (what runs now) |
|---|---|---|
| **Splunk MCP Server** (app 7931, `/services/mcp`) | agent routes its Splunk reads through it | direct 443 REST proxy; an **in-repo MCP server** (`mcp/server.mjs`) wraps the client so "MCP" is real either way |
| **Cisco Deep Time Series Hosted Model** | `HOSTED_MODEL_URL` is set → used as the volume oracle | **SPL-native `| predict`** on the real volume series (real Splunk ML) — the forecast band is genuinely computed from your data |
| **AI Assistant for SPL** | — | Gemini drafts SPL, then we **execute it and prove it returned rows** (never ship unverified SPL) |

---

## How to run

### Prerequisites
- Node 20+.
- A `.env.local` at the repo root (copy `.env.example`). Secrets via env only — never committed.

```bash
# .env.local
SPLUNK_URL=https://your-stack.splunkcloud.com
SPLUNK_USER=your_splunk_user
SPLUNK_PASS=********
GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/vertex-sa.json   # or VERTEX_SA_JSON='{...}'
# optional: DRIFTWOOD_DEMO_INDEX, DRIFTWOOD_VERDICT_INDEX, BASELINE_WINDOW_DAYS, ALERT_WINDOW_MIN, HOSTED_MODEL_URL
```

### Run

```bash
npm install
npm run seed     # ensures driftwood_demo + driftwood_verdicts exist and seeds a realistic 14-day baseline
npm run dev      # http://localhost:3000  (or: npm run build && npm run start)
```

### Drive the money shot
1. Open **Drift Lab** → **Seed baseline + fingerprint** (once).
2. **Arm A · Rename** `status → http_status, then run` → lands on the **NOISE** verdict.
3. **Arm B · Drop 80% of traffic, then run** → the same search, the **NEWS** verdict.
4. Every verdict appears on **The Shore** and is written to `index=driftwood_verdicts` — paste the re-runnable SPL into Splunk to check it yourself.

### Optional: the MCP server
```bash
npm run mcp      # speaks MCP (JSON-RPC) over stdio; exposes splunk_search / splunk_fieldsummary / splunk_volume
```

---

## Design

A calm cream-and-ink ops console with **no red anywhere** — the visual argument *is* the thesis (your pager over-alarms; the cure isn't more alarm). Amber for NOISE (*your instrument drifted*), teal for NEWS and the in-band forecast corridor, monospace numerals for every live figure. The Shape Diff makes "did my instrument break or the world?" instantly legible: a greyed field, a connecting cardinality match to its renamed twin, a volume line inside (or falling out of) a teal band.

## Limitations

Driftwood reasons about the *shape* of data, not its *meaning*: a semantically different field that happens to share a cardinality could fool the rename heuristic, so it surfaces the candidate and the evidence rather than silently asserting. A break that is *both* a schema change and a real outage at once is flagged **AMBIGUOUS** — both signals shown, neither forced. It classifies; it does not (yet) remediate.
