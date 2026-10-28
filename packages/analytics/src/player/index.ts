import { Replayer } from "@rrweb/replay";
import "@rrweb/replay/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import { REPLAY_LIMITS, type ReplayEncoding } from "../shared/replay";
import { readReplayChunk, type ReplayBudget } from "./chunk";

/**
 * Plays session recordings back, for an app's own admin pages. It brings
 * rrweb's player and its styles, so import it lazily, where a recording is
 * about to be watched, never from a page everyone loads.
 */

export interface RecordingChunk {
  /** Where the chunk is stored (the component's `recordings.get` hands these out). */
  url: string;
  encoding: ReplayEncoding;
}

function isEvent(value: unknown): value is eventWithTime {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "number" &&
    "timestamp" in value &&
    typeof value.timestamp === "number"
  );
}

async function chunkEvents(chunk: RecordingChunk, fetcher: typeof fetch, budget: ReplayBudget, signal?: AbortSignal) {
  const response = await fetcher(chunk.url, { signal });
  if (!response.ok || !response.body) throw new Error(`A part of the recording didn't load (${response.status}).`);
  return readReplayChunk(response.body, chunk.encoding, budget);
}

/** A recording's events, from all its chunks, in order. */
export async function loadRecording(
  chunks: readonly RecordingChunk[],
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  signal?: AbortSignal,
): Promise<eventWithTime[]> {
  if (chunks.length > REPLAY_LIMITS.sessionChunks) throw new Error("The recording exceeds its chunk limit.");
  const events: eventWithTime[] = [];
  let bytes = 0;
  let structure = 0;

  // Keep just one expanded chunk alive at a time, and stop before fetching another after a failure.
  for (const chunk of chunks) {
    signal?.throwIfAborted();
    if (bytes >= REPLAY_LIMITS.sessionBytes) throw new Error("The recording exceeds its expanded byte limit.");
    if (events.length >= REPLAY_LIMITS.sessionEvents) throw new Error("The recording exceeds its event limit.");
    if (structure >= REPLAY_LIMITS.sessionStructure) throw new Error("The recording exceeds its JSON structure limit.");
    const part = await chunkEvents(
      chunk,
      fetcher,
      {
        bytes: REPLAY_LIMITS.sessionBytes - bytes,
        events: REPLAY_LIMITS.sessionEvents - events.length,
        structure: REPLAY_LIMITS.sessionStructure - structure,
      },
      signal,
    );
    bytes += part.bytes;
    structure += part.structure;
    for (const event of part.events) if (isEvent(event)) events.push(event);
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * A player for `events` inside `root`. It starts paused at the beginning;
 * `play(offset)` and `pause(offset)` move it, and `getMetaData()` says how
 * long it is. The recorded page is drawn at the size it was recorded at:
 * scale `replayer.wrapper` to fit.
 */
export function createReplayer(root: HTMLElement, events: readonly eventWithTime[]): Replayer {
  return new Replayer([...events], {
    root,
    skipInactive: true,
    showWarning: false,
    mouseTail: false,
    // Recordings never carry scripts; nothing in one should run either way.
    UNSAFE_replayCanvas: false,
  });
}

export type { Replayer };
export type { eventWithTime as RecordedEvent };
