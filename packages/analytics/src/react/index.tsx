import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { Analytics, AnalyticsOptions } from "../browser/client";
import type { FlagState, FlagValue } from "../shared/flags";
import type { Properties } from "../shared/properties";

/**
 * React bindings for the browser SDK. The SDK isn't part of the page's
 * bundle: the provider imports it after the page's load event, in an idle
 * moment, so analytics never competes with the first paint, hydration or
 * the page's own requests. `useAnalytics` returns null until then (and on
 * the server). Only types come from the SDK here; importing its code from
 * this module would put it back in the bundle.
 */

const AnalyticsContext = createContext<Analytics | null>(null);

const NO_FLAGS: FlagState = { values: {}, payloads: {} };
const FlagsContext = createContext<FlagState>(NO_FLAGS);

/** How long an idle callback may wait before it runs anyway. */
const IDLE_TIMEOUT_MS = 3_000;

/**
 * Runs `task` once the page has loaded and the browser is idle (or after a
 * tick where `requestIdleCallback` doesn't exist, as in Safari). Returns a
 * function that cancels it.
 */
export function afterLoad(task: () => void): () => void {
  let cancelled = false;
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (!cancelled) task();
  };
  const schedule = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    } else {
      timer = setTimeout(run, 0);
    }
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", schedule);
    if (idle !== null) window.cancelIdleCallback(idle);
    if (timer !== null) clearTimeout(timer);
  };
}

/**
 * When the visit landed on this page: the navigation's start, as long as
 * the address is still the one it landed on. The SDK loads late, and the
 * landing page view should say when the page was opened, not when the SDK
 * arrived.
 */
export function landedAt(): number | undefined {
  const [navigation] = performance.getEntriesByType("navigation");
  return navigation?.name === location.href ? Math.round(performance.timeOrigin) : undefined;
}

export function AnalyticsProvider({
  options,
  flags = NO_FLAGS,
  children,
}: {
  /** Null turns analytics off: nothing is loaded and nothing is sent. */
  options: AnalyticsOptions | null;
  /** Feature flags for whoever's here, worked out by the server (shared/flags.ts `evaluateFlags`). */
  flags?: FlagState;
  children: ReactNode;
}) {
  const [client, setClient] = useState<Analytics | null>(null);
  const endpoint = options?.endpoint ?? null;
  useEffect(() => {
    // A page inside a frame (like a heatmap's preview of it) isn't a visit.
    if (!options || window.self !== window.top) return;
    let active = true;
    let instance: Analytics | null = null;
    const cancel = afterLoad(() => {
      import("../browser/client")
        .then(({ Analytics }) => {
          if (!active) return;
          instance = new Analytics({ landedAt: landedAt(), ...options });
          setClient(instance);
        })
        // A blocker or a dropped connection kept the SDK away: this page goes uncounted, and nothing else breaks.
        .catch((error: unknown) => console.warn("Analytics didn't load.", error));
    });
    return () => {
      active = false;
      cancel();
      instance?.shutdown();
      setClient(null);
    };
    // One client per endpoint: options arrive as a fresh object with every
    // loader run, and a new client per navigation would mean a new page view.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);
  return (
    <AnalyticsContext value={client}>
      <FlagsContext value={flags}>{children}</FlagsContext>
    </AnalyticsContext>
  );
}

/** The SDK, once it has loaded; null before that and on the server. */
export function useAnalytics(): Analytics | null {
  return useContext(AnalyticsContext);
}

/**
 * Keeps the SDK's idea of who's here in step with the app's: identifies
 * them when they're signed in, and starts a new anonymous visitor when
 * someone who was signed in isn't any more.
 */
export function useIdentify(person: { distinctId: string; set?: Properties } | null): void {
  const client = useAnalytics();
  const distinctId = person?.distinctId ?? null;
  const set = person?.set ? JSON.stringify(person.set) : null;
  useEffect(() => {
    if (!client) return;
    if (distinctId) client.identify(distinctId, set ? (JSON.parse(set) as Properties) : undefined);
    else if (client.identified) client.reset();
  }, [client, distinctId, set]);
}

/**
 * A flag's value for whoever's here: false when it's off or unknown, true
 * when on, or the variant's key. It reads what the server worked out, so
 * the first render already has it; once the SDK has loaded it records that
 * they saw it (once a session), which experiments count.
 */
export function useFeatureFlag(key: string): FlagValue {
  const value = useContext(FlagsContext).values[key] ?? false;
  const client = useAnalytics();
  useEffect(() => {
    client?.flagSeen(key, value);
  }, [client, key, value]);
  return value;
}

/** True when a flag is on, whatever its variant. */
export function useFeatureFlagEnabled(key: string): boolean {
  return useFeatureFlag(key) !== false;
}

/** The parsed JSON payload of the flag's value, when it has one. */
export function useFeatureFlagPayload(key: string): unknown {
  useFeatureFlag(key);
  return useContext(FlagsContext).payloads[key];
}

export type { Analytics, AnalyticsOptions } from "../browser/client";
export type { FlagState, FlagValue } from "../shared/flags";
