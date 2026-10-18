import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Analytics, type AnalyticsOptions } from "../browser/client";
import type { Properties } from "../shared/properties";

/**
 * React bindings for the browser SDK. The provider makes the client after
 * hydration, so server rendering never touches it, and `useAnalytics`
 * returns null until then (and on the server).
 */

const AnalyticsContext = createContext<Analytics | null>(null);

export function AnalyticsProvider({
  options,
  children,
}: {
  /** Null turns analytics off: nothing is made and nothing is sent. */
  options: AnalyticsOptions | null;
  children: ReactNode;
}) {
  const [client, setClient] = useState<Analytics | null>(null);
  const endpoint = options?.endpoint ?? null;
  useEffect(() => {
    if (!options) return;
    const instance = new Analytics(options);
    setClient(instance);
    return () => {
      instance.shutdown();
      setClient(null);
    };
    // One client per endpoint: options arrive as a fresh object with every
    // loader run, and a new client per navigation would mean a new page view.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);
  return <AnalyticsContext value={client}>{children}</AnalyticsContext>;
}

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

export { Analytics, type AnalyticsOptions } from "../browser/client";
export { EVENTS } from "../shared/events";
