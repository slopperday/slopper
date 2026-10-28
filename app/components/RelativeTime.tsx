import { createContext, type ReactNode, useContext } from "react";
import { timeAgo } from "~/lib/dates";
import { useHydrated } from "./Tiles";

const RenderedAtContext = createContext<number | null>(null);

/** Shares the serialized page clock so initial browser text matches server HTML. */
export function RenderTimeProvider({ renderedAt, children }: { renderedAt: number; children: ReactNode }) {
  return <RenderedAtContext value={renderedAt}>{children}</RenderedAtContext>;
}

/** Relative age, using the page clock through hydration and the browser clock after it. */
export function RelativeTime({ at }: { at: string | number }) {
  const renderedAt = useContext(RenderedAtContext);
  const hydrated = useHydrated();

  if (renderedAt === null) throw new Error("RelativeTime needs RenderTimeProvider.");

  const now = new Date(hydrated ? Date.now() : renderedAt);

  return <time dateTime={new Date(at).toISOString()}>{timeAgo(at, now)}</time>;
}
