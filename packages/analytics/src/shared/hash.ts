/** cyrb53: a fast 53-bit hash. It's for buckets and grouping, never for secrets. */
function cyrb53(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * A stable number in [0, 1) for a string: the same person always lands in
 * the same rollout bucket and experiment variant, in the browser and on the
 * server alike.
 */
export function bucketOf(input: string): number {
  return cyrb53(input) / 2 ** 53;
}

/** A short stable id for a string, like an error's fingerprint. */
export function hashOf(input: string): string {
  return cyrb53(input).toString(36);
}
