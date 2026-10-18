import { useState } from "react";
import { useRouteLoaderData } from "react-router";
import { useAnalytics } from "@slopperday/analytics/react";
import type { loader as rootLoader } from "~/root";

/**
 * Turns Slopper's own analytics off (or back on) in this browser. The
 * choice is a cookie the SDK and the server both read, so it holds on every
 * page from the next one on, signed in or not.
 */
export function AnalyticsChoice({ id = "analytics" }: { id?: string }) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const client = useAnalytics();
  const [optedOut, setOptedOut] = useState(root?.analyticsOptedOut ?? false);
  if (!root?.analytics) return null;

  function toggle() {
    if (!client) return;
    if (optedOut) client.optIn();
    else client.optOut();
    setOptedOut(!optedOut);
  }

  return (
    <section id={id} className="mt-16 scroll-mt-24" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="title-2">
        Usage analytics
      </h2>
      <p className="mt-2 text-muted">
        Slopper counts page views and clicks to learn what works and what's broken. It stays in Slopper's own database:
        no analytics company sees it.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4" aria-live="polite">
        <button
          type="button"
          className={`btn btn-sm ${optedOut ? "btn-ink" : "btn-quiet"}`}
          disabled={!client}
          onClick={toggle}
        >
          {optedOut ? "Turn on" : "Turn off"}
        </button>
        <span className="text-sm text-muted">{optedOut ? "Off in this browser" : "On in this browser"}</span>
      </div>
    </section>
  );
}
