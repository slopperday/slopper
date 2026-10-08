/**
 * The seeded splat: one throw of slop (the splat generator's seed 20261006,
 * frozen into paths) in lime over a nudged copy in ink, so the paint stands
 * off the wall in either theme. Its droplets are part of each path.
 */

const INK =
  "M51.4 33.4Q51.7 38.2 58.1 43.6Q64.5 49 56.1 49.8Q47.7 50.4 44 51.4Q40.2 52.4 35.2 52.6Q30.1 52.7 25.5 52.3Q20.9 51.8 20.8 48.3Q20.7 44.8 14.3 41.8Q7.9 38.9 8.5 33.1Q9.1 27.4 10.8 19.7Q12.4 11.9 19.9 14.7Q27.4 17.5 31 17.9Q34.6 18.4 39.8 13.9Q44.9 9.4 50 14.8Q55.2 20.2 53.2 24.5Q51.2 28.7 51.4 33.4ZM35.7 7.3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0ZM41.3 60.6a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0ZM7.2 46.3a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0Z";
const SLOP =
  "M47.4 29.4Q47.6 34.1 54 39.5Q60.4 45 52 45.7Q43.6 46.4 39.9 47.3Q36.1 48.4 31.1 48.5Q26.1 48.7 21.4 48.2Q16.9 47.7 16.7 44.2Q16.6 40.8 10.2 37.8Q3.8 34.8 4.4 29.1Q5 23.3 6.7 15.6Q8.4 7.8 15.9 10.6Q23.4 13.4 27 13.9Q30.6 14.4 35.7 9.8Q40.9 5.3 46 10.7Q51.2 16.1 49.2 20.4Q47.1 24.7 47.4 29.4ZM31.7 3.3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0ZM37.2 56.5a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0ZM3.1 42.2a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0Z";

/**
 * The mark alone. `tone="board"` is for the dark board and tiles, where the
 * offset copy uses the board's light ink instead of the page's.
 */
export function Splat({ className = "", tone = "ground" }: { className?: string; tone?: "ground" | "board" }) {
  return (
    <svg viewBox="2 2 63 61" aria-hidden="true" className={className}>
      <path d={INK} fill={tone === "board" ? "var(--board-ink)" : "var(--ink)"} />
      <path d={SLOP} fill="var(--slop)" />
    </svg>
  );
}

/** The splat, then "slopper". Size it with font-size; the mark scales with the letters. */
export function Wordmark({ className = "text-[1.9rem]" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-[0.22em] font-display leading-none font-black tracking-[-0.01em] whitespace-nowrap ${className}`}
    >
      <Splat className="h-[1.05em] w-auto shrink-0" />
      slopper
    </span>
  );
}
