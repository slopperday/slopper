import { useEffect, useState } from "react";
import { Tiles } from "./Tiles";

const HOUR = 3_600_000;

export const RACE_CLOCK_LABEL = "to midnight UTC";

function untilMidnight(now: Date, utc: boolean): number {
  const midnight = new Date(now);
  if (utc) midnight.setUTCHours(24, 0, 0, 0);
  else midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function parts(ms: number): [string, string, string] {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return [pad(Math.floor(total / 3600)), pad(Math.floor((total % 3600) / 60)), pad(total % 60)];
}

/**
 * Time left until midnight, on board tiles, always with a visible label that
 * names its zone: the visitor's own day (their goal day), or UTC (the slop of
 * the day race). Hours and minutes most of the day; in the last hour the board
 * switches to minutes and seconds and turns red. The local clock also tells
 * the server the visitor's zone through a cookie, so "today" means the same on
 * both sides before anyone signs in.
 */
export function Countdown({
  utc = false,
  label = "left in your day",
  className = "text-[1.05rem]",
}: {
  utc?: boolean;
  label?: string;
  /** Sizes the tiles. */
  className?: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!utc) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      document.cookie = `slopper_tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
    }
    const tick = () => setRemaining(untilMidnight(new Date(), utc));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [utc]);

  const urgent = remaining !== null && remaining < HOUR;
  const [hours, minutes, seconds] = remaining === null ? ["--", "--", "--"] : parts(remaining);
  const shown = urgent ? `${minutes}:${seconds}` : `${hours}:${minutes}`;
  return (
    <span
      className="inline-flex items-center gap-2"
      title={utc ? "Time left in today's race (midnight UTC)" : "Time left to ship today, in your time zone"}
    >
      <span className="sr-only" suppressHydrationWarning>
        {utc ? "Time left in today's race:" : "Time left today:"} {hours}:{minutes}:{seconds}
      </span>
      <Tiles value={shown} className={`${className} ${urgent ? "tiles-urgent" : ""}`} />
      <span className="text-sm leading-tight font-bold text-muted" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
