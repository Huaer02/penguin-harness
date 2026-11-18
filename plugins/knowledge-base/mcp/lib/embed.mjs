// Embeddings for the semantic half of hybrid retrieval: an OpenAI-compatible /embeddings
// endpoint, configured through the host's environment. Optional by design — with no
// configuration the knowledge base runs lexical BM25 alone and needs no credential.

/** The embeddings configuration, or null when it is not configured. */
export function embeddingsConfig(env = process.env) {
  const url = (env.KB_EMBEDDINGS_URL || "").trim();
  const key = (env.KB_EMBEDDINGS_KEY || "").trim();
  const model = (env.KB_EMBEDDINGS_MODEL || "").trim();
  if (!url || !key || !model) return null;
  const parsed = Number.parseInt(env.KB_EMBEDDINGS_DIMENSIONS || "", 10);
  return {
    url: endpoint(url),
    key,
    model,
    dimensions: Number.isFinite(parsed) ? parsed : undefined,
  };
}

/** Accept both a base URL ("https://api.example.com/v1") and a full one (…/embeddings). */
function endpoint(url) {
  return /\/embeddings\/?$/.test(url) ? url : `${url.replace(/\/+$/, "")}/embeddings`;
}

/** Embed texts, `batchSize` per request, in the input order. */
export async function embedTexts(texts, cfg, { batchSize = 64, timeoutMs = 60_000 } = {}) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const body = { model: cfg.model, input: batch };
    if (cfg.dimensions) body.dimensions = cfg.dimensions;
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const response = await res.text();
      const detail = (cfg.key ? response.replaceAll(cfg.key, "[redacted]") : response).slice(
        0,
        300,
      );
      throw new Error(`the embeddings request failed: HTTP ${res.status} ${detail}`);
    }
    const data = await res.json();
    const rows = (data.data || []).slice().sort((a, b) => a.index - b.index);
    if (!Array.isArray(rows) || rows.length !== batch.length) {
      throw new Error(
        `the embeddings endpoint returned ${rows.length} vectors for ${batch.length} inputs`,
      );
    }
    for (const row of rows) vectors.push(row.embedding);
  }
  return vectors;
}
