// The agent's reasoning brain — Google Gemini via Vertex AI.
// Auth: GOOGLE_APPLICATION_CREDENTIALS points at a service-account JSON (roles/aiplatform.user),
// OR set VERTEX_SA_JSON to the raw JSON string (handy for serverless env vars). We mint our own
// OAuth token from the key with google-auth-library — no gcloud dependency at runtime.
//
// Gemini's job is narrow and load-bearing: take SPL-computed numbers (live shape profile,
// baseline fingerprint, forecast residual) and CLASSIFY noise-vs-news + name the drifted field.
// It never decides the numbers — it reasons OVER numbers SPL computed.

import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.VERTEX_PROJECT || "rapid-agents-5166";
const LOCATION = process.env.VERTEX_LOCATION || "global";
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

let auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (auth) return auth;
  const raw = process.env.VERTEX_SA_JSON;
  if (raw && raw.trim().startsWith("{")) {
    auth = new GoogleAuth({ credentials: JSON.parse(raw), scopes: [SCOPE] });
  } else {
    // Uses GOOGLE_APPLICATION_CREDENTIALS file path, or attached SA on Cloud Run.
    auth = new GoogleAuth({ scopes: [SCOPE] });
  }
  return auth;
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.VERTEX_SA_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

async function token(): Promise<string> {
  const client = await getAuth().getClient();
  const t = await client.getAccessToken();
  if (!t.token) throw new Error("Failed to mint Vertex access token");
  return t.token;
}

export interface GeminiResult {
  text: string;
  model: string;
}

export async function generate(
  prompt: string,
  opts: { temperature?: number; maxOutputTokens?: number; system?: string } = {}
): Promise<GeminiResult> {
  const at = await token();
  const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.1,
      // gemini-flash-latest spends a chunk of the budget on internal "thinking" tokens, so the visible
      // output budget must clear that. Cap thinking low and keep enough headroom for the JSON answer.
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (opts.system) {
    body.systemInstruction = { role: "system", parts: [{ text: opts.system }] };
  }
  // A freshly-created SA can return 403 for a few minutes while IAM propagates — retry briefly.
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    if (r.ok) {
      const j = JSON.parse(t);
      const text = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ?? "";
      return { text, model: j.modelVersion || MODEL };
    }
    lastErr = `${r.status}: ${t.slice(0, 300)}`;
    if (r.status === 403 || r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }
  throw new Error("Gemini generateContent failed: " + lastErr);
}

// Parse a JSON object out of a model response that may be fenced or prefixed.
export function extractJson<T = unknown>(text: string): T | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
