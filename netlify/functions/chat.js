// ── YoEcho AI Proxy — Netlify Function ───────────────────────────────────────
// Brain:    Google Gemini (free tier)  → primary
// Fallback: Groq                       → used if every Gemini model fails
//
// Model names retire often, so each provider has an ORDERED LIST of models:
//   • model missing / retired (404, 400)  → try the next model in the list
//   • rate limit (429), bad key (401/403),
//     timeout, 5xx, empty or blocked reply → give up on that provider and
//                                            move straight to the next one
//
// Frontend contract (unchanged):
//   POST { messages:[{role:"user"|"assistant", content}], system }
//   →    { text, provider, model }
//   On total failure → { error, status, details:[...] } so the browser console
//   shows exactly WHY (e.g. "Gemini gemini-3.8-flash HTTP 404 ...").
//
// Netlify env vars:
//   GEMINI_API_KEY     (required)  https://aistudio.google.com/apikey
//   GROQ_API_KEY       (required)  https://console.groq.com/keys
//   MORE KEYS (optional, to spread usage and avoid rate limits). Any of these work, mix freely:
//     GEMINI_API_KEYS = key1,key2,key3,key4      (comma or newline separated)
//     GEMINI_API_KEY_2, GEMINI_API_KEY_3 ... GEMINI_API_KEY_12
//     GROQ_API_KEYS   = key1,key2,key3,key4
//     GROQ_API_KEY_2, GROQ_API_KEY_3 ... GROQ_API_KEY_12
//   A key that hits a rate limit rests for a while and the next key is used.
//   NOTE: limits are per Google project / Groq organisation, so keys must come from different ones to help.
//   GEMINI_MODEL       (optional)  comma-separated list, overrides defaults
//   GROQ_MODEL         (optional)  comma-separated list, overrides defaults
//   GEMINI_TIMEOUT_MS  (optional)  per-attempt, default 6000
//   GROQ_TIMEOUT_MS    (optional)  per-attempt, default 4000
//   MAX_OUTPUT_TOKENS  (optional)  default 1500
//
// If you set GEMINI_MODEL / GROQ_MODEL in Netlify earlier, delete or update
// them — they override the defaults below.
//
// Check current names here when something stops working:
//   Gemini: https://ai.google.dev/gemini-api/docs/deprecations
//   Groq:   https://console.groq.com/docs/deprecations

const list = (v, fallback) =>
  (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback);

const GEMINI_MODELS = list(process.env.GEMINI_MODEL, [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
]);
const GROQ_MODELS = list(process.env.GROQ_MODEL, [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
]);

const GEMINI_TIMEOUT = Number(process.env.GEMINI_TIMEOUT_MS) || 6000;
const GROQ_TIMEOUT = Number(process.env.GROQ_TIMEOUT_MS) || 4000;
// Newer models spend part of this budget "thinking", so keep it generous.
const MAX_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS) || 1500;
let REQ_TOKENS = MAX_TOKENS;   // per-request override (music plans need room for a written melody)
const TEMPERATURE = 0.85;

// Stop trying more models once we're close to Netlify's ~10s function limit.
const TOTAL_BUDGET_MS = Number(process.env.TOTAL_BUDGET_MS) || 9000;

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 500;
  }
}

// ── key pools ────────────────────────────────────────────────────────────────
// Every key found in the environment, de-duplicated. A key that is rate limited rests for a while
// (module-level state: it lives as long as the warm function instance); a key that is rejected rests longer.
function collectKeys(prefix) {
  const out = [];
  const add = (v) => String(v || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).forEach((k) => { if (!out.includes(k)) out.push(k); });
  add(process.env[`${prefix}_API_KEYS`]);
  add(process.env[`${prefix}_API_KEY`]);
  for (let i = 2; i <= 12; i++) add(process.env[`${prefix}_API_KEY_${i}`]);
  return out;
}
const POOLS = { gemini: collectKeys("GEMINI"), groq: collectKeys("GROQ") };
const restUntil = {};   // `${provider}:${index}` -> timestamp
const RATE_REST_MS = Number(process.env.KEY_RATE_REST_MS) || 60000;
const BAD_REST_MS = 10 * 60000;
let rr = 0;
// Free quotas are per key AND per model, so a key rests per model (a bad key rests for every model).
const restKeyName = (provider, idx, model) => `${provider}:${idx}:${model}`;
// keys to try for this model: ready keys in rotating order; if every key is resting, only the one that recovers first
function keyOrder(provider, model) {
  const n = POOLS[provider].length; if (!n) return [];
  const now = Date.now(), ready = [], resting = [];
  for (let i = 0; i < n; i++) {
    const idx = (rr + i) % n, until = Math.max(restUntil[restKeyName(provider, idx, model)] || 0, restUntil[`${provider}:${idx}:*`] || 0);
    (until <= now ? ready : resting).push({ idx, until });
  }
  if (ready.length) return ready.map((x) => x.idx);
  resting.sort((a, b) => a.until - b.until);
  return [resting[0].idx];
}
function restKey(provider, idx, model, status, retryAfterSec) {
  if (status === 429) restUntil[restKeyName(provider, idx, model)] = Date.now() + Math.min(10 * 60000, Math.max(RATE_REST_MS, (Number(retryAfterSec) || 0) * 1000));
  else restUntil[`${provider}:${idx}:*`] = Date.now() + BAD_REST_MS;
}

// Model-level problems: try the next model in the same provider.
const isModelProblem = (s) => s === 404 || s === 400;

async function timedFetch(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new ProviderError("timed out", 504);
    throw new ProviderError(`network error: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// Gemini roles: "user" / "model"; must start with "user"; merge repeats.
function toGeminiContents(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const text = String(m.content ?? "");
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n\n" + text;
    else out.push({ role, parts: [{ text }] });
  }
  if (out.length && out[0].role !== "user") {
    out.unshift({ role: "user", parts: [{ text: "[conversation continues]" }] });
  }
  return out;
}

async function callGemini(model, messages, system, capMs, key) {
  if (!key) throw new ProviderError("GEMINI_API_KEY not set", 401);

  const body = {
    contents: toGeminiContents(messages),
    generationConfig: { maxOutputTokens: REQ_TOKENS, temperature: TEMPERATURE },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const res = await timedFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    },
    Math.min(GEMINI_TIMEOUT, capMs)
  );

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const pe = new ProviderError(e?.error?.message || "request failed", res.status);
    pe.retryAfter = res.headers && res.headers.get ? res.headers.get("retry-after") : null;
    throw pe;
  }

  const data = await res.json();
  if (data.promptFeedback?.blockReason) {
    throw new ProviderError(`prompt blocked: ${data.promptFeedback.blockReason}`, 422);
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  // skip "thought" parts if the model returns them
  const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
  if (!text) {
    throw new ProviderError(`no text (${data.candidates?.[0]?.finishReason || "empty"})`, 502);
  }
  return text;
}

async function callGroq(model, messages, system, capMs, key) {
  if (!key) throw new ProviderError("GROQ_API_KEY not set", 401);

  const msgs = [];
  if (system) msgs.push({ role: "system", content: system });
  for (const m of messages) {
    msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") });
  }

  const res = await timedFetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: msgs,
        max_tokens: REQ_TOKENS,
        temperature: TEMPERATURE,
      }),
    },
    Math.min(GROQ_TIMEOUT, capMs)
  );

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const pe = new ProviderError(e?.error?.message || "request failed", res.status);
    pe.retryAfter = res.headers && res.headers.get ? res.headers.get("retry-after") : null;
    throw pe;
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || "").trim();
  if (!text) {
    throw new ProviderError(`no text (${data.choices?.[0]?.finish_reason || "empty"})`, 502);
  }
  return text;
}

// Try each model of one provider, and for each model each available key.
//   • rate limit (429)      → that key rests, try the next key
//   • bad key (401/403)     → that key rests longer, try the next key
//   • model retired (404/400) → next model
//   • anything else (timeout, 5xx, empty) → leave this provider
async function runProvider(name, models, fn, messages, system, started, details, statuses) {
  const provider = name.toLowerCase();
  if (!POOLS[provider].length) { details.push(`${name}: no API key set`); statuses.push(401); return null; }
  for (const model of models) {
    let modelRetired = false;
    rr = (rr + 1) % Math.max(1, POOLS[provider].length);
    const order = keyOrder(provider, model);
    for (const idx of order) {
      if (Date.now() - started > TOTAL_BUDGET_MS) {
        details.push(`${name}: out of time budget, skipped remaining attempts`);
        statuses.push(504);
        return null;
      }
      try {
        const capMs = Math.max(1500, TOTAL_BUDGET_MS - (Date.now() - started) + 500);
        const text = await fn(model, messages, system, capMs, POOLS[provider][idx]);
        return { text, model };
      } catch (err) {
        const line = `${name} ${model} key#${idx + 1} HTTP ${err.status}: ${String(err.message).slice(0, 160)}`;
        details.push(line);
        statuses.push(err.status);
        console.warn("[YoEcho]", line);
        if (err.status === 429 || err.status === 401 || err.status === 403) { restKey(provider, idx, model, err.status, err.retryAfter); continue; }
        if (isModelProblem(err.status)) { modelRetired = true; break; }
        return null;
      }
    }
    if (!modelRetired) {
      // every key was limited or rejected for this model; another model has its own quota on some providers
      if (statuses[statuses.length - 1] === 429) continue;
      return null;
    }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const { messages, system } = payload;
  REQ_TOKENS = Math.min(3000, Math.max(MAX_TOKENS, Number(payload.maxTokens) || 0));
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "messages array required" }) };
  }

  const started = Date.now();
  const details = [];
  const statuses = [];

  const providers = [
    ["Gemini", "gemini", GEMINI_MODELS, callGemini],
    ["Groq", "groq", GROQ_MODELS, callGroq],
  ];

  for (const [label, id, models, fn] of providers) {
    const r = await runProvider(label, models, fn, messages, system, started, details, statuses);
    if (r) {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ text: r.text, provider: id, model: r.model }),
      };
    }
  }

  const rateLimited = statuses.includes(429);
  const status = rateLimited ? 429 : 503;
  console.error("[YoEcho] All providers failed:", JSON.stringify(details));
  return {
    statusCode: status,
    headers: HEADERS,
    body: JSON.stringify({
      error: rateLimited ? "Rate limit reached on AI providers" : "All AI providers unavailable",
      status,
      details,
    }),
  };
};
