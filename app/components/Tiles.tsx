import { useSyncExternalStore } from "react";

const SEPARATORS = new Set([":", "/", " ", "."]);

function subscribe(): () => void {
  return () => {};
}

/**
 * False while the server renders and the client hydrates, true after. Tiles
 * use it to flip into place once the page is live, never in server markup.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** A tile's stagger position, read by the flip animation. */
export function tileOrder(index: number): React.CSSProperties & { "--i": string } {
  return { "--i": String(index) };
}

/**
 * Digits and short ASCII codes on split-flap tiles, one character per tile. Once the page is
 * live, a character that changes remounts its tile and flips into place.
 * Decorative: callers give screen readers the same value as text.
 */
export function Tiles({ value, className = "" }: { value: string; className?: string }) {
  const hydrated = useHydrated();
  return (
    <span className={`tiles ${hydrated ? "tile-flip" : ""} ${className}`} aria-hidden="true">
      {value.split("").map((char, index) =>
        SEPARATORS.has(char) ? (
          <span key={`sep-${index}`} className="tile-sep">
            {char}
          </span>
        ) : (
          <span key={`${index}-${char}`} className="tile" style={tileOrder(index)}>
            <span>{char}</span>
          </span>
        ),
      )}
    </span>
  );
}
