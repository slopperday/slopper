/**
 * Embeddings for search by meaning (convex/search.ts), from OpenRouter's
 * OpenAI-style embeddings API. OPENROUTER_API_KEY on Convex turns them on;
 * without it, search matches words only. OPENROUTER_BASE_URL only changes
 * for tests.
 */

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";

/** The model's vector size. A new model means a new index and embedding every slop again. */
export const EMBEDDING_DIMENSIONS = 1536;

const TIMEOUT_MS = 15_000;

export interface EmbeddingSettings {
  apiKey: string;
  baseUrl: string;
}

/** Null when no key is set, so nothing is embedded. */
export function embeddingSettings(): EmbeddingSettings | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, "") };
}

function isVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

/** One vector per text, in order. Throws on any failure, including a reply of the wrong shape. */
export async function embedTexts(settings: EmbeddingSettings, texts: readonly string[]): Promise<number[][]> {
  const response = await fetch(`${settings.baseUrl}/embeddings`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!response.ok) throw new Error(`Embeddings failed with ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { data?: { embedding?: unknown; index?: unknown }[] };
  const data = [...(body.data ?? [])].sort(
    (a, b) => (typeof a.index === "number" ? a.index : 0) - (typeof b.index === "number" ? b.index : 0),
  );
  const vectors = data.map((item) => item.embedding);
  if (vectors.length !== texts.length || !vectors.every(isVector)) {
    throw new Error(`Embeddings came back malformed: ${vectors.length} for ${texts.length} texts.`);
  }
  return vectors;
}
