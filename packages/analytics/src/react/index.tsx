import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { Analytics, AnalyticsOptions } from "../browser/client";
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
  children,
}: {
  /** Null turns analytics off: nothing is loaded and nothing is sent. */
  options: AnalyticsOptions | null;
  children: ReactNode;
}) {
  const [client, setClient] = useState<Analytics | null>(null);
  const endpoint = options?.endpoint ?? null;
  useEffect(() => {
    if (!options) return;
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
  return <AnalyticsContext value={client}>{children}</AnalyticsContext>;
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

export type { Analytics, AnalyticsOptions } from "../browser/client";
