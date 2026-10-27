import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingChunk, Replayer } from "@slopperday/analytics/player";
import { formatDuration } from "~/lib/insights";

/**
 * Plays a session's recording. rrweb's player (and its styles) load only
 * here, once the page is open, from @slopperday/analytics/player. The
 * recorded page is drawn at the size it was recorded at, scaled to fit.
 */

export interface ReplayMarker {
  /** When it happened, in ms since the epoch, like the session's events. */
  at: number;
  label: string;
  kind: "page" | "click" | "rage";
}

type Status =
  | { kind: "loading" }
  | { kind: "ready"; start: number; total: number }
  | { kind: "failed"; message: string };

const SPEEDS = [1, 2, 4, 8] as const;
/** A marker jumps to a moment before what it marks, to see it coming. */
const LEAD_MS = 1_000;
/**
 * Recording starts once the page has loaded and the SDK is in, a moment
 * after the visit landed: what happened that close before it sits at its start.
 */
const BEFORE_START_MS = 30_000;
/** And what happened just after the last recorded moment (a page view with nothing after it) sits at its end. */
const AFTER_END_MS = 5_000;

const MARKER_COLORS: Record<ReplayMarker["kind"], string> = {
  page: "bg-ink",
  click: "bg-slop",
  rage: "bg-hot",
};

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ReplayPlayer({
  chunks,
  markers,
}: {
  chunks: readonly RecordingChunk[];
  markers: readonly ReplayMarker[];
}) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const replayer = useRef<Replayer | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [skipQuiet, setSkipQuiet] = useState(true);
  const chunkKey = chunks.map((chunk) => chunk.url).join("\n");

  /** Scales the recorded page to the frame's width, and the frame to its height. */
  const fit = useCallback(() => {
    const player = replayer.current;
    const box = frame.current;
    if (!player || !box) return;
    const width = Number(player.iframe.width) || player.iframe.offsetWidth;
    const height = Number(player.iframe.height) || player.iframe.offsetHeight;
    if (!width || !height) return;
    const scale = Math.min(1, box.clientWidth / width);
    player.wrapper.style.transformOrigin = "top left";
    player.wrapper.style.transform = `scale(${scale})`;
    box.style.height = `${Math.round(height * scale)}px`;
  }, []);

  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    let cancelled = false;
    const controller = new AbortController();
    let made: Replayer | null = null;
    setStatus({ kind: "loading" });
    void (async () => {
      const player = await import("@slopperday/analytics/player");
      controller.signal.throwIfAborted();
      const events = await player.loadRecording(chunks, undefined, controller.signal);
      if (cancelled) return;
      if (events.length < 2) {
        setStatus({ kind: "failed", message: "There's nothing in this recording to play." });
        return;
      }
      made = player.createReplayer(root, events);
      replayer.current = made;
      made.on("finish", () => setPlaying(false));
      made.on("resize", fit);
      // Draws the first moment, so there's a page to look at before playing.
      made.pause(0);
      fit();
      const meta = made.getMetaData();
      setStatus({ kind: "ready", start: meta.startTime, total: meta.totalTime });
    })().catch((error: unknown) => {
      if (cancelled) return;
      setStatus({ kind: "failed", message: error instanceof Error ? error.message : "The recording didn't load." });
    });
    return () => {
      cancelled = true;
      controller.abort();
      made?.destroy();
      replayer.current = null;
      setPlaying(false);
      setCurrent(0);
    };
    // A recording is its chunks: new loader data with the same chunks is the same recording.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkKey, fit]);

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    if (!playing) return;
    let tick = requestAnimationFrame(function update() {
      if (replayer.current) setCurrent(replayer.current.getCurrentTime());
      tick = requestAnimationFrame(update);
    });
    return () => cancelAnimationFrame(tick);
  }, [playing]);

  const total = status.kind === "ready" ? status.total : 0;
  const start = status.kind === "ready" ? status.start : 0;

  function seek(offset: number) {
    const to = Math.max(0, Math.min(total, offset));
    if (playing) replayer.current?.play(to);
    else replayer.current?.pause(to);
    setCurrent(to);
  }

  function toggle() {
    const player = replayer.current;
    if (!player) return;
    if (playing) {
      player.pause();
      setCurrent(player.getCurrentTime());
      setPlaying(false);
    } else {
      player.play(current >= total ? 0 : current);
      setPlaying(true);
    }
  }

  return (
    <section aria-labelledby="replay-title" className="mt-10">
      <h2 id="replay-title" className="title-2">
        Recording
      </h2>
      <div ref={frame} className="relative mt-4 min-h-40 overflow-hidden rounded-xl border border-line bg-sunk">
        <div ref={stage} />
        {status.kind !== "ready" && (
          <p
            role={status.kind === "failed" ? "alert" : "status"}
            className="absolute inset-0 grid place-items-center p-4 text-center text-muted"
          >
            {status.kind === "loading" ? "Loading the recording…" : status.message}
          </p>
        )}
      </div>
      {status.kind === "ready" && (
        <div className="mt-3 grid gap-3">
          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-sm btn-ink w-20" onClick={toggle}>
              {playing ? "Pause" : "Play"}
            </button>
            <div className="relative flex-1">
              <input
                type="range"
                min={0}
                max={total}
                step={100}
                value={Math.min(current, total)}
                onChange={(event) => seek(Number(event.target.value))}
                aria-label="Position in the recording"
                aria-valuetext={`${clock(current)} of ${clock(total)}`}
                className="w-full accent-slop"
              />
              <ol className="pointer-events-none absolute inset-x-0 -bottom-2 h-2" aria-label="What happened">
                {markers
                  .filter((marker) => marker.at >= start - BEFORE_START_MS && marker.at <= start + total + AFTER_END_MS)
                  .map((marker) => {
                    const offset = Math.min(total, Math.max(0, marker.at - start));
                    return (
                      <li
                        key={`${marker.at}-${marker.label}`}
                        className="absolute top-0"
                        style={{ left: `${(offset / Math.max(1, total)) * 100}%` }}
                      >
                        <button
                          type="button"
                          title={`${marker.label} (${clock(offset)})`}
                          aria-label={`Jump to ${marker.label}, at ${clock(offset)}`}
                          onClick={() => seek(offset - LEAD_MS)}
                          className={`pointer-events-auto block h-2 w-1 -translate-x-1/2 rounded-full ${MARKER_COLORS[marker.kind]}`}
                        />
                      </li>
                    );
                  })}
              </ol>
            </div>
            <span className="w-24 text-right text-sm text-muted tabular-nums">
              {clock(current)} / {clock(total)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex gap-1" role="group" aria-label="Speed">
              {SPEEDS.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={speed === choice}
                  className={`btn btn-sm ${speed === choice ? "btn-ink" : "bg-raised"}`}
                  onClick={() => {
                    setSpeed(choice);
                    replayer.current?.setConfig({ speed: choice });
                  }}
                >
                  {choice}×
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={skipQuiet}
                onChange={(event) => {
                  setSkipQuiet(event.target.checked);
                  replayer.current?.setConfig({ skipInactive: event.target.checked });
                }}
              />
              Skip the quiet bits
            </label>
            <span className="text-muted">{formatDuration(total)} recorded</span>
          </div>
        </div>
      )}
    </section>
  );
}
