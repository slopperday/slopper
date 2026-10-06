import { useEffect, useState } from "react";

function untilMidnight(now: Date, utc: boolean): number {
  const midnight = new Date(now);
  if (utc) midnight.setUTCHours(24, 0, 0, 0);
  else midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Time left until midnight: in the visitor's own zone (their goal day), or in
 * UTC (the slop of the day race). The local clock also tells the server the
 * visitor's zone through a cookie, so "today" means the same on both sides
 * before anyone signs in.
 */
export function Countdown({
  compact = false,
  utc = false,
  label = "left today",
}: {
  compact?: boolean;
  utc?: boolean;
  label?: string;
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

  const urgent = remaining !== null && remaining < 3_600_000;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border-2 border-ink px-3 py-1 font-mono text-[0.7rem] tabular-nums ${
        urgent ? "bg-hot text-white" : "bg-card"
      }`}
      title={utc ? "Time left in today's race (midnight UTC)" : "Time left to ship today, in your time zone"}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${urgent ? "animate-pulse bg-white" : "bg-slop"}`} />
      <span className="sr-only">{utc ? "Time left in today's race:" : "Time left today:"}</span>
      <span suppressHydrationWarning>{remaining === null ? "--:--:--" : format(remaining)}</span>
      {!compact && <span className="hidden uppercase sm:inline">{label}</span>}
    </span>
  );
}
