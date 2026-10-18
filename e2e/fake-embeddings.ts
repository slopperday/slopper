import { EMBEDDING_DIMENSIONS } from "../convex/lib/embeddings.ts";

/**
 * Stand-in embeddings for the tests, shared by the unit tests and the e2e
 * stack's fake OpenRouter. The first dimensions are concepts: a text points
 * along every concept it has a word of, so "budget" lands next to "expense"
 * with no word in common, the way real embeddings place them. Every other
 * word nudges a few hashed dimensions, up or down, so texts with no concept
 * only score close when they share words: two different words rarely share
 * more than one of those dimensions, which is nowhere near a match, where a
 * single dimension each would collide often among the hundreds of unique
 * names the e2e tests make. Category names aren't concepts, or every slop in
 * a category would look alike.
 */
const CONCEPTS: readonly (readonly string[])[] = [
  ["budget", "budgets", "expense", "expenses", "spend", "spending", "savings", "cash", "finance"],
  ["play", "puzzle", "puzzles", "maze", "mazes", "arcade", "level"],
  ["song", "songs", "beat", "beats", "synth", "melody"],
  ["plant", "plants", "garden", "gardening", "watering", "grow"],
];

/** How many hashed dimensions each word nudges. */
const WORD_DIMENSIONS = 8;
/** Each nudge, sized so a word weighs 0.1 in all, a tenth of a concept. */
const NUDGE = 0.1 / Math.sqrt(WORD_DIMENSIONS);

function hash(word: string): number {
  let value = 0;
  for (const char of word) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

/** MurmurHash3's finalizer: nearby inputs land far apart. */
function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

export function fakeEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const concept = CONCEPTS.findIndex((words) => words.includes(word));
    if (concept >= 0) vector[concept] = 1;
    else
      for (let seed = 1; seed <= WORD_DIMENSIONS; seed++) {
        const value = mix(hash(word) ^ Math.imul(seed, 0x9e3779b9));
        const sign = value & 1 ? 1 : -1;
        vector[CONCEPTS.length + ((value >>> 1) % (EMBEDDING_DIMENSIONS - CONCEPTS.length))] += sign * NUDGE;
      }
  }
  return vector;
}
