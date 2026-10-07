/**
 * The drip bang: a fresh splat dripping into an exclamation mark. It trails
 * the wordmark as its punctuation, drop on the baseline, so the lockup reads
 * "slopper!". A darker underside gives the wet paint its edge on light ground.
 */

const SPLAT_AND_DRIP =
  "M44.1 12.1Q43.1 9.8 42.3 7Q41.4 4.2 38.6 4Q35.8 3.8 33 3.1Q30.3 2.4 28.1 4.1Q26 5.9 23.2 7.4Q20.4 8.9 20.6 11.7Q20.8 14.5 22.1 17.1Q23.4 19.8 25.5 22Q27.6 24.2 33 24.2Q38.4 24.2 40.5 22Q42.6 19.8 43.8 17.1Q45 14.5 44.1 12.1ZM22.8 16.4L23.8 40.2A4.2 4.2 0 0 0 31.8 41.8L42.2 20.5A10.2 10.2 0 1 0 22.8 16.4Z";
const DROP = "M19.8 54a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0Z";
const SPLASHES = "M50 7.5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0ZM10.9 24a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0Z";

/**
 * The mark alone. `splash` adds the loose droplets, for sizes big enough to
 * show them (the lockup and anything under ~40px leave them off).
 */
export function Bang({ className = "", splash = false }: { className?: string; splash?: boolean }) {
  return (
    <svg viewBox={splash ? "8 1 48 62" : "18.5 1.5 29.5 61"} aria-hidden="true" className={className}>
      <g fill="var(--slop-deep)" transform="translate(1.4 1.4)">
        <path d={SPLAT_AND_DRIP} />
        <path d={DROP} />
      </g>
      <g fill="var(--slop)">
        <path d={SPLAT_AND_DRIP} />
        <path d={DROP} />
        {splash && <path d={SPLASHES} />}
      </g>
    </svg>
  );
}

/** "slopper!" Size it with font-size; the mark scales with the letters. */
export function Wordmark({ className = "text-[1.9rem]" }: { className?: string }) {
  return (
    <span className={`font-display leading-none font-black tracking-[-0.01em] whitespace-nowrap ${className}`}>
      slopper
      <Bang className="ml-[0.03em] inline-block h-[0.84em] w-auto align-baseline" />
    </span>
  );
}
