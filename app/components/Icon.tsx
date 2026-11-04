/** The few drawn icons Slopper uses: one 24px grid, one 2px stroke. */

const PATHS = {
  up: "M12 19V5M5.5 11.5 12 5l6.5 6.5",
  down: "M12 5v14M5.5 12.5 12 19l6.5-6.5",
  bell: "M6 9.5a6 6 0 0 1 12 0c0 4.5 1.8 6.2 2.5 7H3.5c.7-.8 2.5-2.5 2.5-7ZM10 20a2.2 2.2 0 0 0 4 0",
  star: "m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z",
  close: "M6 6l12 12M18 6 6 18",
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM20 20l-4.4-4.4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  right: "M5 12h14M13 6l6 6-6 6",
  left: "M19 12H5M11 6l-6 6 6 6",
  out: "M8 16 16 8M9 8h7v7",
  expand: "M9 4H4v5M20 9V4h-5M15 20h5v-5M4 15v5h5",
  plus: "M12 5v14M5 12h14",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3 2",
  copy: "M9 9h10.5v10.5H9ZM15 9V4.5H4.5V15H9",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  play: "M8 5.5v13l10.5-6.5Z",
  page: "M6.5 3.5h7l4 4v13h-11ZM13.5 3.5v4h4M9.5 12h5M9.5 15.5h5",
  sync: "M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5",
  eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12ZM12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z",
  eyeOff:
    "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12ZM12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5ZM4 4l16 16",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "size-5",
  filled = false,
}: {
  name: IconName;
  className?: string;
  /** Fill closed shapes (the star) as well as stroking them. */
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
