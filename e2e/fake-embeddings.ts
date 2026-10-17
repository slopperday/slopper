import { EMBEDDING_DIMENSIONS } from "../convex/lib/embeddings.ts";

/**
 * Stand-in embeddings for the tests, shared by the unit tests and the e2e
 * stack's fake OpenRouter. The first dimensions are concepts: a text points
 * along every concept it has a word of, so "budget" lands next to "expense"
 * with no word in common, the way real embeddings place them. Every other
 * word nudges a hashed dimension, so texts with no concept only score close
 * when they share words. Category names aren't concepts, or every slop in
 * a category would look alike.
 */
const CONCEPTS: readonly (readonly string[])[] = [
  ["budget", "budgets", "expense", "expenses", "spend", "spending", "savings", "cash", "finance"],
  ["play", "puzzle", "puzzles", "maze", "mazes", "arcade", "level"],
  ["song", "songs", "beat", "beats", "synth", "melody"],
  ["plant", "plants", "garden", "gardening", "watering", "grow"],
];

function hash(word: string): number {
  let value = 0;
  for (const char of word) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

export function fakeEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const concept = CONCEPTS.findIndex((words) => words.includes(word));
    if (concept >= 0) vector[concept] = 1;
    else vector[CONCEPTS.length + (hash(word) % (EMBEDDING_DIMENSIONS - CONCEPTS.length))] += 0.1;
  }
  return vector;
}
