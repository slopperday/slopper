import { useSyncExternalStore } from "react";

/**
 * How much the site moves. Everyone gets their device's setting
 * (`prefers-reduced-motion`) unless they chose otherwise in Settings, a
 * cookie the server reads so the page arrives already moving or still:
 * root.tsx puts it on <html data-motion>, which app.css and the charts follow.
 */

export const MOTION_COOKIE = "slopper_motion";

/** "reduce" keeps things still, "full" animates whatever the device says; null follows the device. */
export type MotionChoice = "reduce" | "full" | null;

export function parseMotion(value: string | null | undefined): MotionChoice {
  return value === "reduce" || value === "full" ? value : null;
}

/** The choice as a cookie to write in the browser, or one that clears it. */
export function motionCookie(choice: MotionChoice): string {
  const base = `${MOTION_COOKIE}=${choice ?? ""}; path=/; samesite=lax`;
  return choice ? `${base}; max-age=31536000` : `${base}; max-age=0`;
}

const QUERY = "(prefers-reduced-motion: reduce)";

function reducedNow(): boolean {
  const choice = parseMotion(document.documentElement.dataset.motion);
  if (choice) return choice === "reduce";
  return window.matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/** Whether to keep still: the choice in Settings, or the device's setting. False while rendering on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedNow, () => false);
}
