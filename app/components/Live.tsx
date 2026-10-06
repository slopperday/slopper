import { ConvexReactClient } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useState } from "react";

/**
 * Live data. Pages render from loader data on the server, then subscribe to
 * the same Convex query in the browser, so votes, races, feedback and
 * notifications update in place for everyone.
 */

const LiveContext = createContext<ConvexReactClient | null>(null);

async function fetchToken(): Promise<string | null> {
  const response = await fetch("/api/convex-token", { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  const body = (await response.json()) as { token?: string };
  return body.token ?? null;
}

export function LiveProvider({
  url,
  signedIn,
  children,
}: {
  url: string | null;
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const [client, setClient] = useState<ConvexReactClient | null>(null);

  // Browser only: the client opens a websocket.
  useEffect(() => {
    if (!url) return;
    const instance = new ConvexReactClient(url);
    setClient(instance);
    return () => void instance.close();
  }, [url]);

  useEffect(() => {
    if (!client) return;
    if (signedIn) client.setAuth(fetchToken);
    else client.clearAuth();
  }, [client, signedIn]);

  return <LiveContext.Provider value={client}>{children}</LiveContext.Provider>;
}

export function useLiveClient(): ConvexReactClient | null {
  return useContext(LiveContext);
}

/**
 * `initial` (from the loader) until the live subscription answers, then the
 * live value from there on.
 */
export function useLive<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
  initial: FunctionReturnType<Query>,
): FunctionReturnType<Query> {
  const client = useLiveClient();
  const key = JSON.stringify(args);
  const [live, setLive] = useState<{ key: string; value: FunctionReturnType<Query> } | null>(null);

  useEffect(() => {
    if (!client) return;
    const watch = client.watchQuery(query, args);
    const read = () => {
      const value = watch.localQueryResult();
      if (value !== undefined) setLive({ key, value });
    };
    read();
    return watch.onUpdate(read);
    // `key` captures `args`; `query` references are stable.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  return live && live.key === key ? live.value : initial;
}
