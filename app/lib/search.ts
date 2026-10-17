import { findCategory } from "./model";

/**
 * Search vocabulary shared by the wall, the agent operation and Convex
 * (convex/search.ts): how a query is read, what a slop's embedding is made
 * from, and how the rankings are merged.
 */

/** The most results one search returns. */
export const SEARCH_LIMIT = 48;

/** The longest search read, in characters. */
export const SEARCH_QUERY_LENGTH = 100;

/** Convex full-text search reads at most 16 terms. */
const SEARCH_TERMS = 16;

/** A search as it's run: trimmed, single-spaced and cut to size. Empty means no search. */
export function normalizeQuery(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean).slice(0, SEARCH_TERMS);
  return words.join(" ").slice(0, SEARCH_QUERY_LENGTH).trim();
}

export interface EmbeddingSource {
  name: string;
  tagline: string;
  description: string;
  category: string;
  madeWith: readonly string[];
}

/** What a slop's embedding is made from: everything that says what it is and what it's for. */
export function embeddingText(slop: EmbeddingSource): string {
  const category = findCategory(slop.category)?.label ?? slop.category;
  const lines = [`${slop.name}: ${slop.tagline}`, `Category: ${category}`];
  if (slop.madeWith.length > 0) lines.push(`Made with ${slop.madeWith.join(", ")}`);
  if (slop.description.trim()) lines.push(slop.description.trim());
  return lines.join("\n");
}

/** One ranking to merge, best first. */
export interface Ranking<Id> {
  ids: readonly Id[];
  /** How much a place in this ranking counts against the others. */
  weight: number;
}

/**
 * Damps how much first place beats tenth, so a slop that several rankings
 * agree on beats one that tops a single ranking. 60 is the usual constant
 * for reciprocal rank fusion.
 */
const RANK_DAMPING = 60;

/**
 * Merges rankings by weighted reciprocal rank fusion: each ranking gives an
 * id `weight / (60 + place)`, and ids are ordered by their total. Only places
 * count, so rankings with incomparable scores (text relevance, vector
 * similarity) merge fairly. Ties keep the order ids were first seen in.
 */
export function fuseRankings<Id>(rankings: readonly Ranking<Id>[]): Id[] {
  const scores = new Map<Id, number>();
  for (const { ids, weight } of rankings) {
    ids.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + weight / (RANK_DAMPING + index + 1)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
