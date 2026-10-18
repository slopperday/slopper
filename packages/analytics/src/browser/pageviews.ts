import { EVENTS } from "../shared/events";
import type { Properties } from "../shared/properties";

/**
 * Page views and page leaves. In a single-page app a "page" is a path: a
 * new history entry with a new pathname is a page view, and leaving it (to
 * another path, or closing the tab) is a page leave with how long it was
 * open and how far down it was scrolled.
 */

/**
 * Captures an event on a given page (a leave is recorded after the address
 * already changed), at `at` when that isn't now.
 */
type Capture = (name: string, properties: Properties, path: string, at?: number) => void;

const UTM_PARAMETERS = {
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_term: "utmTerm",
  utm_content: "utmContent",
} as const;

interface CurrentPage {
  path: string;
  shownAt: number;
  /** How far down the page has been seen, from 0 to 1. */
  scrollDepth: number;
}

function scrollDepth(): number {
  const height = document.documentElement.scrollHeight;
  if (height <= 0) return 1;
  return Math.min(1, (window.scrollY + window.innerHeight) / height);
}

export class PageTracker {
  private current: CurrentPage | null = null;
  private firstView = true;

  constructor(
    private readonly capture: Capture,
    private readonly currentPath: () => string,
  ) {}

  /** Records a view of the current page (opened at `at`, if not now), and a leave of the one before it. */
  view(at?: number): void {
    const path = this.currentPath();
    if (this.current?.path === path) return;
    const previous = this.current?.path ?? null;
    this.leave();
    const properties: Properties = {
      title: document.title.slice(0, 200),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen.width,
    };
    if (this.firstView) {
      // Only the page the visit landed on has a meaningful referrer: later
      // views in a single-page app keep the landing page's.
      if (document.referrer) properties.referrer = document.referrer;
      const search = new URLSearchParams(location.search);
      for (const [parameter, key] of Object.entries(UTM_PARAMETERS)) {
        const value = search.get(parameter);
        if (value) properties[key] = value.slice(0, 200);
      }
    } else if (previous) {
      properties.previousPath = previous;
    }
    this.firstView = false;
    const shownAt = Math.min(at ?? Date.now(), Date.now());
    this.current = { path, shownAt, scrollDepth: scrollDepth() };
    this.capture(EVENTS.pageview, properties, path, shownAt);
  }

  /** Records leaving the current page, if one is being viewed. */
  leave(): void {
    const page = this.current;
    if (!page) return;
    this.current = null;
    this.capture(
      EVENTS.pageleave,
      {
        duration: Date.now() - page.shownAt,
        // What was tracked while it was open: by now the address may be another page's.
        scrollDepth: Math.round(page.scrollDepth * 100) / 100,
      },
      page.path,
    );
  }

  /** Forgets the current page without leaving it, so the next `view` counts even on the same path. */
  forget(): void {
    this.current = null;
  }

  /** Keeps the deepest scroll seen on this page. */
  scrolled(): void {
    if (this.current) this.current.scrollDepth = Math.max(this.current.scrollDepth, scrollDepth());
  }
}

/**
 * Calls `onChange` after every history change, including the app's own
 * `pushState` and `replaceState`, which fire no event of their own. The
 * call waits a tick so the new page has rendered its title.
 */
export function watchHistory(onChange: () => void): () => void {
  const notify = () => setTimeout(onChange, 0);
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  history.pushState = (...args: Parameters<History["pushState"]>) => {
    pushState(...args);
    notify();
  };
  history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    replaceState(...args);
    notify();
  };
  window.addEventListener("popstate", notify);
  return () => {
    history.pushState = pushState;
    history.replaceState = replaceState;
    window.removeEventListener("popstate", notify);
  };
}
