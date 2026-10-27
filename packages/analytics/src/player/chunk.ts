import { REPLAY_LIMITS, type ReplayEncoding } from "../shared/replay";

export interface ReplayBudget {
  bytes: number;
  events: number;
  /** Opening JSON containers and separators, counted outside strings. */
  structure: number;
}

/** Bounds nesting, event counts and allocations before JSON.parse creates the tree. */
function checkStructure(json: string, budget: Pick<ReplayBudget, "events" | "structure">): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let events = 1;
  let structure = 0;

  for (const char of json) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === "[" || char === "{") {
      depth += 1;
      structure += 1;
    } else if (char === "]" || char === "}") depth -= 1;
    else if (char === ",") {
      structure += 1;
      if (depth === 1) events += 1;
    } else if (char === ":") structure += 1;

    if (depth > REPLAY_LIMITS.jsonDepth) throw new Error("The recording exceeds its JSON depth limit.");
    if (events > budget.events) throw new Error("The recording exceeds its event limit.");
    if (structure > budget.structure) throw new Error("The recording exceeds its JSON structure limit.");
  }

  return structure;
}

/**
 * Reads untrusted replay bytes with a cap on expanded output, then checks
 * JSON depth, structure, event counts and envelopes before rrweb sees them.
 */
export async function readReplayChunk(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  encoding: ReplayEncoding,
  budget: ReplayBudget = {
    bytes: REPLAY_LIMITS.expandedChunkBytes,
    events: REPLAY_LIMITS.chunkEvents,
    structure: REPLAY_LIMITS.chunkStructure,
  },
): Promise<{ events: unknown[]; bytes: number; structure: number }> {
  const maxBytes = Math.min(budget.bytes, REPLAY_LIMITS.expandedChunkBytes);
  const maxEvents = Math.min(budget.events, REPLAY_LIMITS.chunkEvents);
  let wireBytes = 0;
  // Small gzip input slices bound each inflater allocation before the expanded-output check.
  const sliced =
    encoding === "gzip"
      ? body.pipeThrough(
          new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
            transform(chunk, controller) {
              wireBytes += chunk.byteLength;
              if (wireBytes > REPLAY_LIMITS.chunkBytes)
                throw new Error("The recording exceeds its compressed byte limit.");
              for (let offset = 0; offset < chunk.byteLength; offset += 1_024)
                controller.enqueue(chunk.subarray(offset, offset + 1_024));
            },
          }),
        )
      : body;
  const stream = encoding === "gzip" ? sliced.pipeThrough(new DecompressionStream("gzip")) : sliced;
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let json = "";

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new Error("The recording exceeds its expanded byte limit.");
      json += decoder.decode(next.value, { stream: true });
    }
    json += decoder.decode();
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }

  const structure = checkStructure(json, {
    events: maxEvents,
    structure: Math.min(budget.structure, REPLAY_LIMITS.chunkStructure),
  });
  const parsed: unknown = JSON.parse(json);

  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error("A recording chunk must be a nonempty event list.");
  const events: unknown[] = parsed;
  if (events.length > maxEvents) throw new Error("The recording exceeds its event limit.");

  for (const event of events) {
    if (
      typeof event !== "object" ||
      event === null ||
      !("type" in event) ||
      !Number.isInteger(event.type) ||
      typeof event.type !== "number" ||
      event.type < 0 ||
      event.type > 6 ||
      !("timestamp" in event) ||
      typeof event.timestamp !== "number" ||
      !Number.isFinite(event.timestamp) ||
      !("data" in event) ||
      typeof event.data !== "object" ||
      event.data === null ||
      Array.isArray(event.data)
    )
      throw new Error("A recording chunk contains an invalid event.");
  }

  return { events, bytes, structure };
}
