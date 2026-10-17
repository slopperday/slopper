---
slopper:
  type: feat
---

# Hybrid search over slops: Convex full-text plus OpenRouter embeddings

`search.find` (Convex action) ranks name, tagline and description matches from three search indexes and the nearest slops from a vector index on `slopEmbeddings`, fused by weighted reciprocal rank. Embeddings (`openai/text-embedding-3-small` through OpenRouter) are made by a Convex action when a slop launches or its text changes. To turn search by meaning on, set `OPENROUTER_API_KEY` on Convex and run `npx convex run --prod search:backfill` once; without the key, search matches words only. `slops.recent` and `slops.hot` take several categories, each read from its own index range, and `recent` pages by creation time (`before`).
