import { useMemo } from "react";
import { splatShape } from "~/lib/splat";

/** A splat of slop. Colour comes from `currentColor`. */
export function Splat({
  seed,
  className = "",
  style,
  stretch = false,
}: {
  seed: number;
  className?: string;
  style?: React.CSSProperties;
  /** Fill the box instead of staying round, e.g. behind a word. */
  stretch?: boolean;
}) {
  const shape = useMemo(() => splatShape(seed), [seed]);
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio={stretch ? "none" : undefined}
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={shape.path} fill="currentColor" />
      {shape.droplets.map((drop) => (
        <circle key={`${drop.cx}-${drop.cy}`} cx={drop.cx} cy={drop.cy} r={drop.r} fill="currentColor" />
      ))}
    </svg>
  );
}
