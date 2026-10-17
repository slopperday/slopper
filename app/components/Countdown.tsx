import { type PointerEvent, useEffect, useRef, useState } from "react";
import { raceClock, secondsToUtcMidnight } from "~/lib/countdown";
import { Tiles } from "./Tiles";

/** How long a finger holds the clock before it shows the seconds. */
const LONG_PRESS_MS = 400;
/** How long the seconds stay after the finger lifts, so they can be read. */
const LINGER_MS = 3000;

/**
 * The seconds, on demand: while a mouse hovers, or after a long press until a
 * moment after the finger lifts.
 */
function useSecondsOnDemand() {
  const [showSeconds, setShowSeconds] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const showAfter = (show: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShowSeconds(show), ms);
  };
  const hover = (show: boolean) => (event: PointerEvent) => {
    if (event.pointerType === "mouse") setShowSeconds(show);
  };
  const press = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") showAfter(true, LONG_PRESS_MS);
  };
  const release = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    if (showSeconds) showAfter(false, LINGER_MS);
    else clearTimeout(timer.current);
  };

  return {
    showSeconds,
    handlers: {
      onPointerEnter: hover(true),
      onPointerLeave: hover(false),
      onPointerDown: press,
      onPointerUp: release,
      onPointerCancel: release,
    },
  };
}

/**
 * Time left until midnight UTC, when today's race closes, on board tiles with
 * a label that names the zone, so every visitor sees the same time. Hours and
 * minutes all day, with the seconds on hover or a long press; in the last hour
 * the board turns red.
 */
export function Countdown({ className = "text-[1.05rem]" }: { /** Sizes the tiles. */ className?: string }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const { showSeconds, handlers } = useSecondsOnDemand();

  useEffect(() => {
    const tick = () => setSecondsLeft(secondsToUtcMidnight(new Date()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const clock = secondsLeft === null ? null : raceClock(secondsLeft);
  const board = clock === null ? "--:--" : showSeconds ? clock.textWithSeconds : clock.text;
  return (
    <span
      className="inline-flex items-center gap-2 select-none [-webkit-touch-callout:none]"
      title="Time left in today's race (midnight UTC)"
      {...handlers}
    >
      <span className="sr-only" suppressHydrationWarning>
        Time left in today's race: {clock?.spoken ?? "--"}
      </span>
      <Tiles value={board} className={`${className} ${clock?.lastHour ? "tiles-urgent" : ""}`} />
      <span className="text-sm leading-tight font-bold text-muted" aria-hidden="true">
        to midnight UTC
      </span>
    </span>
  );
}
