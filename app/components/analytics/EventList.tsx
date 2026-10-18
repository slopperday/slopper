import type { PropertyValue } from "@slopperday/analytics/shared";
import { timeAgo } from "~/lib/dates";
import { formatDuration } from "~/lib/insights";

export interface ListedEvent {
  _id: string;
  name: string;
  path: string | null;
  timestamp: number;
  properties: Record<string, PropertyValue>;
}

/** Properties worth showing in a list, in this order; the rest are behind "more". */
const HEADLINE = ["text", "href", "eventType", "category", "kind", "value", "provider", "referrer", "utmSource"];

function show(value: PropertyValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/**
 * Events in a list: what happened, where, and the properties that say most
 * about it. `since` shows times as offsets from a session's start.
 */
export function EventList({ events, since }: { events: ListedEvent[]; since?: number }) {
  if (events.length === 0) return <p className="mt-4 text-muted">Nothing yet.</p>;
  return (
    <ol className="mt-6 grid gap-2">
      {events.map((event) => {
        const headline = HEADLINE.flatMap((key) => {
          const value = event.properties[key];
          return value === undefined || value === null ? [] : [`${key}: ${show(value)}`];
        });
        const rest = Object.entries(event.properties).filter(([key]) => !HEADLINE.includes(key));
        return (
          <li key={event._id} className="rounded-lg bg-raised px-3 py-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-bold">{event.name}</span>
                {event.path && <span className="ml-2 font-mono text-xs text-muted">{event.path}</span>}
              </span>
              <span className="text-muted tabular-nums">
                {since === undefined ? timeAgo(event.timestamp) : `+${formatDuration(event.timestamp - since)}`}
              </span>
            </div>
            {headline.length > 0 && <p className="mt-1 truncate text-muted">{headline.join(" · ")}</p>}
            {rest.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-muted">{rest.length} more</summary>
                <dl className="mt-1 grid gap-1 text-xs">
                  {rest.map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3">
                      <dt className="text-muted">{key}</dt>
                      <dd className="text-right break-all">{value === null ? "null" : show(value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
