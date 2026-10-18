import { Form, Link, useLocation, useNavigation } from "react-router";
import type { Route } from "./+types/analytics.insights";
import { api } from "@convex/_generated/api";
import { ANY_EVENT, type InsightQuery } from "@slopperday/analytics/shared/insights";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import {
  DAY_CHOICES,
  daysOf,
  eventLabel,
  INSIGHT_LABELS,
  type InsightKind,
  insightQuery,
  isInsightKind,
} from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { ChartPanel } from "~/components/analytics/Charts";
import {
  FunnelChart,
  LifecycleChart,
  PathsDiagram,
  RetentionGrid,
  StickinessChart,
  TrendsChart,
} from "~/components/analytics/InsightCharts";

/**
 * Insights for admins: trends, funnels, retention, journeys, stickiness and
 * lifecycle. Every insight is a URL (a GET form), so it can be bookmarked,
 * shared, and asked of the agent API with the same parameters.
 */

const KINDS: InsightKind[] = ["trends", "funnel", "retention", "paths", "stickiness", "lifecycle", "groups"];

const LEDES: Record<InsightKind, string> = {
  trends: "How often things happen, or how many people do them, over time.",
  funnel: "How many people go through steps in order, and where they drop off.",
  retention: "Of the people who did one thing, how many came back to do another.",
  paths: "The routes people take through the pages, visit by visit.",
  stickiness: "How many days in the range people came back to do something.",
  lifecycle: "Each period's people: new, returning, back after a break, or gone quiet.",
  web: "Visitors, sessions and page views.",
  groups: "Every slop's page views against the period before: which are climbing, which are fading.",
};

/** Property keys worth breaking down by: the SDK's own, and Slopper's product events'. */
const BREAKDOWNS = ["path", "eventType", "tag", "text", "href", "category", "provider", "kind", "value", "country"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const params = new URL(request.url).searchParams;
  const asked = params.get("kind");
  const kind: InsightKind = isInsightKind(asked) && asked !== "web" ? asked : "trends";
  let query: InsightQuery = insightQuery(kind, params, Date.now());
  // A breakdown splits one event: more events and the lines would be unreadable.
  if (query.kind === "trends" && query.breakdown) query = { ...query, series: query.series.slice(0, 1) };
  const [answer, eventNames] = await Promise.all([
    convex.action(api.analytics.insight, { adminId: admin._id, query }),
    convex.query(api.analytics.eventNames, { adminId: admin._id }),
  ]);
  return { kind, query, answer, eventNames, days: daysOf(params) };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Insights", noindex: true });

function EventSelect({
  name,
  value,
  events,
  label,
  optional = false,
}: {
  name: string;
  value: string | undefined;
  events: string[];
  label: string;
  optional?: boolean;
}) {
  const options = [...new Set([...(value && value !== ANY_EVENT ? [value] : []), ...events])].sort();
  return (
    <label className="grid gap-1 text-sm">
      <span className="field-label">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="input">
        {optional && <option value="">None</option>}
        <option value={ANY_EVENT}>Any event</option>
        {options.map((event) => (
          <option key={event} value={event}>
            {eventLabel(event) === event ? event : `${eventLabel(event)} (${event})`}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  name,
  label,
  value,
  placeholder,
}: {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="field-label">{label}</span>
      <input name={name} defaultValue={value ?? ""} placeholder={placeholder} className="input" autoComplete="off" />
    </label>
  );
}

function NumberField({
  name,
  label,
  value,
  min,
  max,
}: {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="field-label">{label}</span>
      <input name={name} type="number" defaultValue={value} min={min} max={max} className="input" />
    </label>
  );
}

function IntervalSelect({ value, choices }: { value: string; choices: readonly ("day" | "week" | "month")[] }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="field-label">Per</span>
      <select name="interval" defaultValue={value} className="input">
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    </label>
  );
}

function QueryFields({ query, events }: { query: InsightQuery; events: string[] }) {
  switch (query.kind) {
    case "trends":
      return (
        <>
          {[0, 1, 2, 3].map((index) => (
            <EventSelect
              key={index}
              name="event"
              label={index === 0 ? "Event" : `And event ${index + 1}`}
              value={query.series[index]?.event}
              events={events}
              optional={index > 0}
            />
          ))}
          <label className="grid gap-1 text-sm">
            <span className="field-label">Count</span>
            <select name="math" defaultValue={query.series[0]?.math ?? "total"} className="input">
              <option value="total">Events</option>
              <option value="persons">People</option>
              <option value="sessions">Sessions</option>
            </select>
          </label>
          <IntervalSelect value={query.interval} choices={["day", "week", "month"]} />
          <label className="grid gap-1 text-sm">
            <span className="field-label">Split by</span>
            <input name="breakdown" list="breakdowns" defaultValue={query.breakdown ?? ""} className="input" />
            <datalist id="breakdowns">
              {BREAKDOWNS.map((key) => (
                <option key={key} value={key} />
              ))}
            </datalist>
          </label>
        </>
      );
    case "funnel":
      return (
        <>
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const step = query.steps[index];
            const path = step?.filters?.find((filter) => filter.key === "path")?.value;
            return (
              <fieldset key={index} className="grid gap-2">
                <EventSelect
                  name="event"
                  label={`Step ${index + 1}`}
                  value={step?.event}
                  events={events}
                  optional={index > 1}
                />
                <TextField
                  name="stepPath"
                  label="On page (optional)"
                  value={path === undefined ? "" : String(path)}
                  placeholder="/new"
                />
              </fieldset>
            );
          })}
          <NumberField name="window" label="Within days" value={query.windowDays} min={1} max={90} />
        </>
      );
    case "retention":
      return (
        <>
          <EventSelect name="start" label="People who did" value={query.startEvent} events={events} />
          <EventSelect name="return" label="Came back to do" value={query.returnEvent} events={events} />
          <IntervalSelect value={query.interval} choices={["day", "week"]} />
          <NumberField name="periods" label="Periods" value={query.periods} min={2} max={26} />
        </>
      );
    case "paths":
      return (
        <>
          <TextField name="start" label="Starting at" value={query.startPath} placeholder="/" />
          <TextField name="end" label="Leading to" value={query.endPath} placeholder="/new" />
          <NumberField name="steps" label="Pages" value={query.steps} min={2} max={10} />
        </>
      );
    case "stickiness":
      return <EventSelect name="event" label="Event" value={query.event} events={events} />;
    case "lifecycle":
      return (
        <>
          <EventSelect name="event" label="Event" value={query.event} events={events} />
          <IntervalSelect value={query.interval} choices={["day", "week", "month"]} />
        </>
      );
    case "web":
      return null;
  }
}

export default function Insights({ loaderData }: Route.ComponentProps) {
  const { kind, query, answer, eventNames, days } = loaderData;
  const { search } = useLocation();
  const navigation = useNavigation();
  const { result } = answer;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Insights" />
      <nav aria-label="Kinds of insight" className="mt-6 flex flex-wrap gap-2">
        {KINDS.map((option) => {
          const params = new URLSearchParams({ kind: option, days: String(days) });
          return (
            <Link
              key={option}
              to={`?${params.toString()}`}
              aria-current={option === kind ? "page" : undefined}
              className={`btn btn-sm ${option === kind ? "btn-ink" : "bg-raised"}`}
            >
              {INSIGHT_LABELS[option]}
            </Link>
          );
        })}
      </nav>
      <p className="lede mt-6 max-w-2xl">{LEDES[kind]}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Form method="get" className="panel grid content-start gap-4" key={search}>
          <input type="hidden" name="kind" value={kind} />
          <label className="grid gap-1 text-sm">
            <span className="field-label">Last</span>
            <select name="days" defaultValue={String(days)} className="input">
              {DAY_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} days
                </option>
              ))}
            </select>
          </label>
          <QueryFields query={query} events={eventNames} />
          <button type="submit" className="btn btn-slop justify-self-start" disabled={navigation.state !== "idle"}>
            {navigation.state === "idle" ? "Show" : "Working…"}
          </button>
        </Form>

        <ChartPanel title={INSIGHT_LABELS[kind]}>
          {answer.truncated && (
            <p role="status" className="text-sm text-muted">
              More happened than one insight reads: this covers the start of the range.
            </p>
          )}
          {result.kind === "trends" && query.kind === "trends" && (
            <TrendsChart result={result} interval={query.interval} title={INSIGHT_LABELS.trends} />
          )}
          {result.kind === "funnel" && query.kind === "funnel" && <FunnelChart result={result} query={query} />}
          {result.kind === "retention" && <RetentionGrid result={result} />}
          {result.kind === "paths" && <PathsDiagram result={result} />}
          {result.kind === "stickiness" && <StickinessChart result={result} />}
          {result.kind === "lifecycle" && query.kind === "lifecycle" && (
            <LifecycleChart result={result} interval={query.interval} />
          )}
        </ChartPanel>
      </div>
    </section>
  );
}
