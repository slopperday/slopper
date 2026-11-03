import { useState } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/studio.calendar";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { NETWORK_LABELS, type SocialProvider } from "~/lib/networks";
import { seo } from "~/lib/seo";
import { NetworkBadge, StudioNav, type DeliveryStatus } from "~/components/Studio";

const DAY = 86_400_000;

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const [posts, accounts] = await Promise.all([
    convex.query(api.social.list, { userId: user._id, limit: 200 }),
    convex.query(api.accounts.list, { userId: user._id }),
  ]);
  return {
    timeZone: user.timeZone,
    now: Date.now(),
    posts: posts.map((post) => ({
      id: post.id,
      at: post.scheduledAt ?? post.createdAt,
      text: post.options.youtube?.title || post.text || "Untitled",
      draft: post.draft,
      cancelled: post.cancelled,
      scheduled: post.scheduledAt !== null && !post.released && !post.cancelled && !post.draft,
      movable:
        post.scheduledAt !== null && !post.released && !post.cancelled && !post.draft && post.scheduledAt > Date.now(),
      tags: post.tags,
      providers: [...new Set(post.deliveries.map((row) => row.provider))],
      statuses: post.deliveries.map((row) => row.status),
      instagram: post.deliveries.filter((row) => row.provider === "instagram").map((row) => row.accountId),
      thumb: post.media.find((item) => item.kind === "image")?.url ?? post.cover?.url ?? null,
    })),
    instagram: accounts
      .filter((account) => account.provider === "instagram")
      .map((account) => ({ id: account._id, handle: account.handle })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  if (formText(form, "intent") !== "move") return { error: null };
  try {
    await convex.mutation(api.social.reschedule, {
      userId: user._id,
      postId: formText(form, "postId"),
      scheduledAt: Number(formText(form, "scheduledAt")),
    });
    return { error: null };
  } catch (error) {
    return { error: convexMessage(error) ?? "Couldn't move it." };
  }
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Studio calendar", noindex: true });

type CalendarPost = Route.ComponentProps["loaderData"]["posts"][number];

/** YYYY-MM-DD of `at` in `timeZone`. */
function dayKey(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(at);
}

function statusOf(post: CalendarPost): "draft" | "scheduled" | "failed" | "sent" | "cancelled" {
  if (post.draft) return "draft";
  if (post.cancelled) return "cancelled";
  if (post.scheduled) return "scheduled";
  return post.statuses.some((status: DeliveryStatus) => status === "error") ? "failed" : "sent";
}

const STATUS_STYLE = {
  draft: "border-dashed border-line bg-ground",
  scheduled: "border-ink bg-raised",
  sent: "border-transparent bg-slop/15",
  failed: "border-hot bg-hot/10",
  cancelled: "border-transparent bg-sunk opacity-60",
} as const;

export default function StudioCalendar({ loaderData }: Route.ComponentProps) {
  const { posts, timeZone, now, instagram } = loaderData;
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const [dragging, setDragging] = useState<string | null>(null);
  const view = params.get("view") ?? "month";
  const network = params.get("network");
  const tag = params.get("tag");
  const status = params.get("status");
  const anchor = Date.parse(`${params.get("date") ?? dayKey(now, timeZone)}T12:00:00Z`) || now;

  const allTags = [...new Set(posts.flatMap((post) => post.tags))];
  const shown = posts.filter(
    (post) =>
      (!network || post.providers.includes(network as SocialProvider)) &&
      (!tag || post.tags.includes(tag)) &&
      (!status || statusOf(post) === status),
  );
  const byDay = new Map<string, CalendarPost[]>();
  for (const post of shown) {
    const key = dayKey(post.at, timeZone);
    byDay.set(
      key,
      [...(byDay.get(key) ?? []), post].sort((a, b) => a.at - b.at),
    );
  }

  // Days on screen, as noon UTC of each date: a month from its Monday, or one week.
  const anchorDate = new Date(anchor);
  const first =
    view === "week"
      ? anchor - ((anchorDate.getUTCDay() + 6) % 7) * DAY
      : (() => {
          const start = Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1, 12);
          return start - ((new Date(start).getUTCDay() + 6) % 7) * DAY;
        })();
  const days = Array.from({ length: view === "week" ? 7 : 42 }, (_, index) => first + index * DAY);
  const step = view === "week" ? 7 * DAY : 31 * DAY;
  const set = (name: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { preventScrollReset: true });
  };

  function drop(day: number) {
    const post = posts.find((item) => item.id === dragging);
    setDragging(null);
    if (!post?.movable) return;
    const from = Date.parse(`${dayKey(post.at, timeZone)}T12:00:00Z`);
    const moved = post.at + Math.round((day - from) / DAY) * DAY;
    if (moved === post.at) return;
    void fetcher.submit({ intent: "move", postId: post.id, scheduledAt: String(moved) }, { method: "post" });
  }

  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(anchor);

  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 pb-16">
      <h1 className="title-1">Studio</h1>
      <div className="mt-8">
        <StudioNav />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-sunk p-1" role="group" aria-label="View">
          {(["month", "week", "list", "grid"] as const).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => set("view", name)}
              aria-pressed={view === name}
              className={`min-h-9 rounded-lg px-3 font-bold capitalize ${view === name ? "bg-ink text-ground" : "text-muted"}`}
            >
              {name === "grid" ? "Instagram grid" : name}
            </button>
          ))}
        </div>
        {(view === "month" || view === "week") && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => set("date", dayKey(anchor - step, "UTC"))}
              aria-label="Earlier"
            >
              ←
            </button>
            <span className="min-w-36 text-center font-bold">{title}</span>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => set("date", dayKey(anchor + step, "UTC"))}
              aria-label="Later"
            >
              →
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => set("date", null)}>
              Today
            </button>
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <select
            className="input min-h-9 w-auto py-1"
            value={network ?? ""}
            onChange={(event) => set("network", event.target.value || null)}
            aria-label="Network"
          >
            <option value="">All networks</option>
            {Object.entries(NETWORK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="input min-h-9 w-auto py-1"
            value={status ?? ""}
            onChange={(event) => set("status", event.target.value || null)}
            aria-label="Status"
          >
            <option value="">Every status</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Drafts</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          {allTags.length > 0 && (
            <select
              className="input min-h-9 w-auto py-1"
              value={tag ?? ""}
              onChange={(event) => set("tag", event.target.value || null)}
              aria-label="Tag"
            >
              <option value="">Every tag</option>
              {allTags.map((name) => (
                <option key={name} value={name}>
                  #{name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {fetcher.data?.error && (
        <p className="mt-3 text-hot" role="alert">
          {fetcher.data.error}
        </p>
      )}
      <p className="mt-3 text-sm text-muted">
        Times in {timeZone}. Drag a scheduled post to another day to move it.{" "}
        <Link to="/studio/settings" className="underline">
          Calendar feed for your calendar app
        </Link>
      </p>

      {(view === "month" || view === "week") && (
        <div className="mt-4 overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 gap-px overflow-hidden rounded-2xl bg-line">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
              <div key={name} className="bg-ground px-2 py-1 text-xs font-bold text-muted">
                {name}
              </div>
            ))}
            {days.map((day) => {
              const key = dayKey(day, "UTC");
              const inMonth = view === "week" || new Date(day).getUTCMonth() === anchorDate.getUTCMonth();
              const today = key === dayKey(now, timeZone);
              return (
                <div
                  key={key}
                  onDragOver={(event) => dragging && event.preventDefault()}
                  onDrop={() => drop(day)}
                  className={`bg-ground p-1.5 ${view === "week" ? "min-h-80" : "min-h-28"} ${inMonth ? "" : "opacity-50"}`}
                  aria-label={key}
                >
                  <p
                    className={`text-xs font-bold ${today ? "inline-block rounded-full bg-slop px-1.5 text-ink" : "text-muted"}`}
                  >
                    {new Date(day).getUTCDate()}
                  </p>
                  <ul className="mt-1 grid gap-1">
                    {(byDay.get(key) ?? []).map((post) => (
                      <li
                        key={post.id}
                        draggable={post.movable}
                        onDragStart={() => setDragging(post.id)}
                        onDragEnd={() => setDragging(null)}
                        className={post.movable ? "cursor-grab" : ""}
                      >
                        <Link
                          to={`/studio/posts/${post.id}`}
                          className={`block rounded-lg border px-1.5 py-1 text-xs ${STATUS_STYLE[statusOf(post)]}`}
                        >
                          <span className="flex items-center gap-1">
                            <span className="font-bold tabular-nums">{clock(post.at, timeZone)}</span>
                            {post.providers.slice(0, 4).map((provider) => (
                              <NetworkBadge key={provider} provider={provider} size="sm" />
                            ))}
                          </span>
                          <span className="mt-0.5 line-clamp-2">{post.text}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "list" && (
        <ul className="mt-4 grid gap-2">
          {shown
            .slice()
            .sort((a, b) => b.at - a.at)
            .map((post) => (
              <li key={post.id}>
                <Link
                  to={`/studio/posts/${post.id}`}
                  className={`flex items-center gap-3 rounded-2xl border p-3 ${STATUS_STYLE[statusOf(post)]}`}
                >
                  <span className="w-40 shrink-0 text-sm tabular-nums">
                    {new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(
                      post.at,
                    )}
                  </span>
                  <span className="line-clamp-1 min-w-0 flex-1 font-bold">{post.text}</span>
                  <span className="text-xs font-bold text-muted capitalize">{statusOf(post)}</span>
                  <span className="flex gap-1">
                    {post.providers.map((provider) => (
                      <NetworkBadge key={provider} provider={provider} size="sm" />
                    ))}
                  </span>
                </Link>
              </li>
            ))}
        </ul>
      )}

      {view === "grid" &&
        (instagram.length === 0 ? (
          <p className="mt-6 text-muted">Connect an Instagram account to plan its grid.</p>
        ) : (
          instagram.map((account) => {
            const tiles = posts
              .filter((post) => post.instagram.includes(account.id) && !post.cancelled)
              .sort((a, b) => b.at - a.at)
              .slice(0, 18);
            return (
              <div key={account.id} className="mt-6">
                <h2 className="title-3">@{account.handle}</h2>
                <p className="text-sm text-muted">
                  How the profile will look, newest first. Scheduled posts are outlined.
                </p>
                <div className="mt-3 grid max-w-md grid-cols-3 gap-1">
                  {tiles.map((post) => (
                    <Link
                      key={post.id}
                      to={`/studio/posts/${post.id}`}
                      className={`relative aspect-square overflow-hidden bg-sunk ${post.scheduled || post.draft ? "outline-2 -outline-offset-2 outline-ink outline-dashed" : ""}`}
                      title={post.text}
                    >
                      {post.thumb ? (
                        <img src={post.thumb} alt="" className="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center p-2 text-center text-xs">
                          {post.text.slice(0, 60)}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })
        ))}
    </section>
  );
}
