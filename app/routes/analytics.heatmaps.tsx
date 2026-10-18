import { Form, Link, useLocation } from "react-router";
import type { Route } from "./+types/analytics.heatmaps";
import { api } from "@convex/_generated/api";
import type { HeatmapDevice } from "@slopperday/analytics/shared/insights";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import { DAY_CHOICES, daysOf, formatCount, formatPercent, HEATMAP_DEVICE_LABELS, heatmapQuery } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav, DaysPicker } from "~/components/analytics/AnalyticsNav";
import { Stat } from "~/components/analytics/Charts";
import { HeatmapPreview } from "~/components/analytics/HeatmapPreview";

/**
 * Where people click on a page and how far down they get, for one kind of
 * screen: the page as it is now, with the clicks of the last days over it.
 */

const SUGGESTED = ["/", "/wall", "/today", "/new", "/goal"] as const;
const DEVICES: readonly HeatmapDevice[] = ["mobile", "tablet", "desktop"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const params = new URL(request.url).searchParams;
  const query = heatmapQuery(params, Date.now());
  const answer = await convex.action(api.analytics.insight, { adminId: admin._id, query });
  if (answer.result.kind !== "heatmap") throw new Error("A heatmap insight answered with another kind.");
  return { heatmap: answer.result, truncated: answer.truncated, days: daysOf(params) };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Heatmaps", noindex: true });

function withParam(search: string, key: string, value: string): string {
  const params = new URLSearchParams(search);
  params.set(key, value);
  return `?${params.toString()}`;
}

export default function Heatmaps({ loaderData }: Route.ComponentProps) {
  const { heatmap, truncated, days } = loaderData;
  const { search } = useLocation();
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Heatmaps">
        <DaysPicker days={days} choices={DAY_CHOICES} search={search} />
      </AnalyticsNav>

      <Form method="get" className="mt-8 flex flex-wrap items-end gap-3">
        <input type="hidden" name="device" value={heatmap.device} />
        <input type="hidden" name="days" value={days} />
        <label className="grid gap-1 text-sm">
          <span className="field-label">Page</span>
          <input name="path" defaultValue={heatmap.path} className="input w-72 font-mono" list="heatmap-pages" />
          <datalist id="heatmap-pages">
            {SUGGESTED.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
        </label>
        <button type="submit" className="btn bg-raised">
          Show
        </button>
        <div className="flex gap-1" role="group" aria-label="Screen">
          {DEVICES.map((device) => (
            <Link
              key={device}
              to={withParam(search, "device", device)}
              aria-current={device === heatmap.device ? "true" : undefined}
              className={`btn btn-sm ${device === heatmap.device ? "btn-ink" : "bg-raised"}`}
              preventScrollReset
            >
              {HEATMAP_DEVICE_LABELS[device]}
            </Link>
          ))}
        </div>
      </Form>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat label="Clicks" value={formatCount(heatmap.clicks)} />
        <Stat label="Views" value={formatCount(heatmap.views)} />
        <Stat
          label="Read to the end"
          value={heatmap.views === 0 ? "—" : formatPercent(heatmap.reached[10] ?? 0)}
          hint="Of the visits that left the page"
        />
      </div>
      {truncated && (
        <p className="mt-4 text-sm text-muted">
          There were too many events to read them all: these counts are partial.
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_14rem]">
        <section aria-labelledby="heatmap-title">
          <h2 id="heatmap-title" className="sr-only">
            Clicks on {heatmap.path}
          </h2>
          {heatmap.clicks === 0 && (
            <p className="mb-3 text-sm text-muted">
              No clicks on {heatmap.path} from a {HEATMAP_DEVICE_LABELS[heatmap.device].toLowerCase()} in this range.
            </p>
          )}
          <HeatmapPreview path={heatmap.path} width={heatmap.width} cell={heatmap.cell} cells={heatmap.cells} />
        </section>
        <aside className="grid content-start gap-6">
          <section aria-labelledby="scroll-title" className="panel">
            <h2 id="scroll-title" className="font-display text-xl font-extrabold">
              How far down
            </h2>
            <ol className="mt-3 grid gap-1 text-sm">
              {heatmap.reached.slice(1).map((share, index) => (
                <li key={index} className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2">
                  <span className="text-muted tabular-nums">{(index + 1) * 10}%</span>
                  <span className="h-2 overflow-hidden rounded-full bg-sunk">
                    <span className="block h-full rounded-full bg-hot" style={{ width: `${share * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{formatPercent(share)}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted">The share of visits that scrolled at least that far.</p>
          </section>
          <section aria-labelledby="elements-title" className="panel">
            <h2 id="elements-title" className="font-display text-xl font-extrabold">
              Clicked most
            </h2>
            {heatmap.elements.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No links or buttons clicked yet.</p>
            ) : (
              <ol className="mt-3 grid gap-1 text-sm">
                {heatmap.elements.map((element) => (
                  <li key={element.label} className="flex justify-between gap-3">
                    <span className="truncate">{element.label}</span>
                    <span className="tabular-nums">{formatCount(element.clicks)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
