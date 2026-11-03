import { Link } from "react-router";
import type { Route } from "./+types/studio.analytics";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { type ChannelReport, channelReport } from "~/.server/social/youtube";
import { NETWORKS, type SocialProvider, type StatName } from "~/lib/networks";
import { seo } from "~/lib/seo";
import { DataTable, LineChart } from "~/components/analytics/Charts";
import {
  AccountAvatar,
  formatCount,
  type Metrics,
  NetworkBadge,
  type StudioAccount,
  StudioNav,
  sumMetrics,
} from "~/components/Studio";

const DAY = 86_400_000;
const RANGES = [7, 28, 90] as const;

/** Channel reports are read live from YouTube, so keep each for a few minutes. */
const reports = new Map<string, { at: number; report: ChannelReport | null }>();

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 28;
  const now = Date.now();
  const since = now + 1 - days * DAY;
  const [accounts, sent, posts] = await Promise.all([
    convex.query(api.accounts.list, { userId: user._id }),
    convex.query(api.social.sent, { userId: user._id, since }),
    convex.query(api.social.list, { userId: user._id, limit: 200 }),
  ]);
  const clicks = await convex.query(api.social.clicks, {
    userId: user._id,
    postIds: [...new Set(sent.map((row) => row.postId))],
  });

  const from = new Date(since).toISOString().slice(0, 10);
  const to = new Date(now).toISOString().slice(0, 10);
  const youtube = [];
  for (const account of accounts.filter((item) => item.provider === "youtube")) {
    const key = `${account._id}:${days}`;
    let hit = reports.get(key);
    if (!hit || now - hit.at > 10 * 60_000) {
      const report = await channelReport(account, from, to).catch((error: unknown) => {
        console.warn("Reading a YouTube channel report failed", error);
        return null;
      });
      hit = { at: now, report };
      reports.set(key, hit);
    }
    youtube.push({ accountId: account._id, title: account.displayName, report: hit.report });
  }

  return {
    days,
    accounts: accounts.map(({ _id, provider, handle, displayName, avatarUrl, brand }): StudioAccount => ({
      id: _id,
      provider,
      handle,
      displayName,
      avatarUrl,
      brand: brand ?? null,
    })),
    sent,
    clicks,
    timeZone: user.timeZone,
    posts: posts.map((post) => ({ id: post.id, text: post.text, title: post.options.youtube?.title ?? null })),
    youtube,
  };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Studio analytics", noindex: true });

const ORDER: readonly StatName[] = ["views", "likes", "comments", "shares", "reposts", "saves"];

function engagement(metrics: Metrics): number {
  return (
    (metrics.likes ?? 0) +
    (metrics.comments ?? 0) +
    (metrics.shares ?? 0) +
    (metrics.reposts ?? 0) +
    (metrics.saves ?? 0)
  );
}

export default function StudioAnalytics({ loaderData }: Route.ComponentProps) {
  const { days, accounts, sent, posts, youtube, clicks, timeZone } = loaderData;
  const totals = sumMetrics(sent.map((row) => row.metrics));
  const postCount = new Set(sent.map((row) => row.postId)).size;

  const byNetwork = new Map<SocialProvider, { copies: number; metrics: Metrics }>();
  for (const row of sent) {
    const entry = byNetwork.get(row.provider) ?? { copies: 0, metrics: {} };
    byNetwork.set(row.provider, { copies: entry.copies + 1, metrics: sumMetrics([entry.metrics, row.metrics]) });
  }
  const byAccount = accounts
    .map((account) => {
      const rows = sent.filter((row) => row.accountId === account.id);
      return { account, copies: rows.length, metrics: sumMetrics(rows.map((row) => row.metrics)) };
    })
    .filter((entry) => entry.copies > 0)
    .sort((a, b) => engagement(b.metrics) - engagement(a.metrics));

  const byPost = new Map<string, { metrics: Metrics; providers: Set<SocialProvider> }>();
  for (const row of sent) {
    const entry = byPost.get(row.postId) ?? { metrics: {}, providers: new Set() };
    entry.metrics = sumMetrics([entry.metrics, row.metrics]);
    entry.providers.add(row.provider);
    byPost.set(row.postId, entry);
  }
  const top = [...byPost.entries()]
    .map(([id, entry]) => ({ id, ...entry, post: posts.find((post) => post.id === id) }))
    .sort(
      (a, b) =>
        (b.metrics.views ?? 0) + engagement(b.metrics) * 10 - ((a.metrics.views ?? 0) + engagement(a.metrics) * 10),
    )
    .slice(0, 5);

  // What kind of post did best: format, network by network.
  const byFormat = new Map<string, { copies: number; metrics: Metrics }>();
  for (const row of sent.filter((item) => !item.repost)) {
    const format = row.story
      ? "Story"
      : row.shape.documents
        ? "Document"
        : row.shape.video !== null
          ? "Video"
          : row.shape.images > 1
            ? "Several pictures"
            : row.shape.images === 1
              ? "One picture"
              : row.shape.thread
                ? "Thread"
                : "Words only";
    const entry = byFormat.get(format) ?? { copies: 0, metrics: {} };
    byFormat.set(format, { copies: entry.copies + 1, metrics: sumMetrics([entry.metrics, row.metrics]) });
  }
  // Hashtags in what was sent, by average engagement.
  const byHashtag = new Map<string, { copies: number; engagement: number }>();
  for (const row of sent.filter((item) => !item.repost)) {
    for (const tag of new Set((row.text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((item) => item.toLowerCase()))) {
      const entry = byHashtag.get(tag) ?? { copies: 0, engagement: 0 };
      byHashtag.set(tag, { copies: entry.copies + 1, engagement: entry.engagement + engagement(row.metrics ?? {}) });
    }
  }
  const hashtags = [...byHashtag.entries()]
    .sort(([, a], [, b]) => b.engagement / b.copies - a.engagement / a.copies)
    .slice(0, 10);
  const clicksByNetwork = new Map<SocialProvider, number>();
  for (const row of clicks) clicksByNetwork.set(row.provider, (clicksByNetwork.get(row.provider) ?? 0) + row.clicks);
  // Engagement day by day, in the person's time zone.
  const dayOf = (at: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const daily = new Map<string, { engagement: number; views: number }>();
  for (let index = days - 1; index >= 0; index--)
    daily.set(dayOf(Date.now() - index * DAY), { engagement: 0, views: 0 });
  for (const row of sent) {
    const entry = daily.get(dayOf(row.sentAt));
    if (!entry || !row.metrics) continue;
    entry.engagement += engagement(row.metrics);
    entry.views += row.metrics.views ?? 0;
  }

  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 pb-16">
      <h1 className="title-1">Studio</h1>
      <div className="mt-8">
        <StudioNav />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="title-2">How your posts did</h2>
        <a href={`/studio/analytics.csv?days=${days}`} className="btn btn-quiet btn-sm" download>
          Download CSV
        </a>
        <nav className="inline-flex rounded-xl bg-sunk p-1" aria-label="Period">
          {RANGES.map((range) => (
            <Link
              key={range}
              to={`?days=${range}`}
              className={`flex min-h-9 items-center rounded-lg px-3 font-bold ${range === days ? "bg-ink text-ground" : "text-muted"}`}
            >
              {range} days
            </Link>
          ))}
        </nav>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="Posts" value={postCount} />
        <Tile label="Copies sent" value={sent.length} />
        <Tile label="Views" value={totals.views} />
        <Tile label="Likes" value={totals.likes} />
        <Tile label="Comments" value={totals.comments} />
        <Tile label="Shares & reposts" value={(totals.shares ?? 0) + (totals.reposts ?? 0)} />
        <Tile label="Link clicks" value={clicks.reduce((total, row) => total + row.clicks, 0)} />
      </dl>

      {sent.length === 0 ? (
        <p className="mt-8 text-muted">
          Nothing sent in the last {days} days.{" "}
          <Link to="/studio" className="link">
            Write a post
          </Link>
          .
        </p>
      ) : (
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="title-3">By network</h3>
            <table className="mt-3 w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-2 font-bold">
                    Network
                  </th>
                  <th scope="col" className="py-2 text-right font-bold">
                    Posts
                  </th>
                  {ORDER.slice(0, 4).map((name) => (
                    <th key={name} scope="col" className="py-2 text-right font-bold capitalize">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...byNetwork.entries()].map(([provider, entry]) => (
                  <tr key={provider} className="border-b border-line">
                    <td className="py-2">
                      <span className="flex items-center gap-2 font-bold">
                        <NetworkBadge provider={provider} size="sm" /> {NETWORKS[provider].label}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{entry.copies}</td>
                    {ORDER.slice(0, 4).map((name) => (
                      <td key={name} className="py-2 text-right font-bold tabular-nums">
                        {formatCount(entry.metrics[name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="title-3">By account</h3>
            <ul className="mt-3 grid gap-2">
              {byAccount.map(({ account, copies, metrics }) => (
                <li key={account.id} className="flex items-center gap-3 rounded-2xl bg-raised p-3">
                  <AccountAvatar account={account} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{account.displayName}</p>
                    <p className="text-xs text-muted">
                      {account.brand ? `${account.brand} · ` : ""}
                      {copies} post{copies === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="text-right text-sm tabular-nums">
                    <strong>{formatCount(metrics.views)}</strong> views
                    <br />
                    <strong>{formatCount(engagement(metrics))}</strong> engagements
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-2">
            <h3 className="title-3">Top posts</h3>
            <ol className="mt-3 grid gap-2">
              {top.map((entry, index) => (
                <li key={entry.id}>
                  <Link
                    to={`/studio/posts/${entry.id}`}
                    className="flex items-center gap-3 rounded-2xl bg-raised p-3 hover:bg-sunk"
                  >
                    <span className="w-6 font-display text-2xl font-extrabold text-muted">{index + 1}</span>
                    <p className="line-clamp-1 min-w-0 flex-1 font-bold">
                      {entry.post?.title || entry.post?.text || "Post"}
                    </p>
                    <span className="flex gap-1">
                      {[...entry.providers].map((provider) => (
                        <NetworkBadge key={provider} provider={provider} size="sm" />
                      ))}
                    </span>
                    <span className="text-right text-sm whitespace-nowrap tabular-nums">
                      {formatCount(entry.metrics.views)} views · {formatCount(engagement(entry.metrics))} eng.
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {sent.length > 0 && (
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <h3 className="title-3">Each day</h3>
            <LineChart
              title="Engagements and views by the day posts went out"
              buckets={[...daily.keys()].map((day) => Date.parse(`${day}T00:00:00Z`))}
              interval="day"
              series={[
                { label: "Engagements", values: [...daily.values()].map((entry) => entry.engagement) },
                { label: "Views", values: [...daily.values()].map((entry) => entry.views) },
              ]}
            />
            <DataTable
              caption="Studio posts by day"
              columns={["Day", "Engagements", "Views"]}
              rows={[...daily.entries()].map(([day, entry]) => [day, entry.engagement, entry.views])}
            />
          </div>
          <div>
            <h3 className="title-3">By format</h3>
            <table className="mt-3 w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-2 font-bold">
                    Format
                  </th>
                  <th scope="col" className="py-2 text-right font-bold">
                    Posts
                  </th>
                  <th scope="col" className="py-2 text-right font-bold">
                    Views
                  </th>
                  <th scope="col" className="py-2 text-right font-bold">
                    Engagements per post
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...byFormat.entries()]
                  .sort(([, a], [, b]) => engagement(b.metrics) / b.copies - engagement(a.metrics) / a.copies)
                  .map(([format, entry]) => (
                    <tr key={format} className="border-b border-line">
                      <td className="py-2 font-bold">{format}</td>
                      <td className="py-2 text-right tabular-nums">{entry.copies}</td>
                      <td className="py-2 text-right tabular-nums">{formatCount(entry.metrics.views)}</td>
                      <td className="py-2 text-right font-bold tabular-nums">
                        {formatCount(Math.round(engagement(entry.metrics) / entry.copies))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="title-3">Hashtags</h3>
            {hashtags.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No hashtags in these posts.</p>
            ) : (
              <table className="mt-3 w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="py-2 font-bold">
                      Hashtag
                    </th>
                    <th scope="col" className="py-2 text-right font-bold">
                      Posts
                    </th>
                    <th scope="col" className="py-2 text-right font-bold">
                      Engagements per post
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hashtags.map(([tag, entry]) => (
                    <tr key={tag} className="border-b border-line">
                      <td className="py-2 font-bold">{tag}</td>
                      <td className="py-2 text-right tabular-nums">{entry.copies}</td>
                      <td className="py-2 text-right font-bold tabular-nums">
                        {formatCount(Math.round(entry.engagement / entry.copies))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {clicksByNetwork.size > 0 && (
            <div>
              <h3 className="title-3">Link clicks</h3>
              <p className="mt-1 text-sm text-muted">From tracked links, by the network they were clicked on.</p>
              <ul className="mt-3 grid gap-1">
                {[...clicksByNetwork.entries()]
                  .sort(([, a], [, b]) => b - a)
                  .map(([provider, count]) => (
                    <li key={provider} className="flex items-center gap-2 text-sm">
                      <NetworkBadge provider={provider} size="sm" />
                      <span className="flex-1 font-bold">{NETWORKS[provider].label}</span>
                      <span className="font-bold tabular-nums">{formatCount(count)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {youtube.length > 0 && (
        <div className="mt-14">
          <h2 className="title-2 flex items-center gap-3">
            <NetworkBadge provider="youtube" /> YouTube channels
          </h2>
          <p className="mt-2 text-muted">
            From YouTube Analytics, for every video on the channel, not only studio posts.
          </p>
          {youtube.map(({ accountId, title, report }) => (
            <div key={accountId} className="panel mt-5">
              <h3 className="title-3">{title}</h3>
              {!report ? (
                <p className="mt-2 text-muted">
                  YouTube didn’t answer just now. Reconnect the channel if this keeps up.
                </p>
              ) : (
                <ChannelSection report={report} days={days} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-2xl bg-raised p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-extrabold tabular-nums">{formatCount(value)}</dd>
    </div>
  );
}

function ChannelSection({ report, days }: { report: ChannelReport; days: number }) {
  const sum = (key: "views" | "minutesWatched" | "subscribersGained" | "subscribersLost" | "likes" | "comments") =>
    report.days.reduce((total, day) => total + day[key], 0);
  const buckets = report.days.map((day) => Date.parse(`${day.date}T00:00:00Z`));
  return (
    <>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Subscribers" value={report.subscribers ?? undefined} />
        <Tile label={`Views, ${days} days`} value={sum("views")} />
        <Tile label="Hours watched" value={Math.round(sum("minutesWatched") / 60)} />
        <Tile label="New subscribers" value={sum("subscribersGained") - sum("subscribersLost")} />
        <Tile label="Likes" value={sum("likes")} />
        <Tile label="Comments" value={sum("comments")} />
      </dl>
      {report.days.length > 1 && (
        <div className="mt-5">
          <LineChart
            title="Views and minutes watched each day"
            buckets={buckets}
            interval="day"
            series={[
              { label: "Views", values: report.days.map((day) => day.views) },
              { label: "Minutes watched", values: report.days.map((day) => day.minutesWatched) },
            ]}
          />
          <DataTable
            caption="YouTube channel by day"
            columns={["Day", "Views", "Minutes watched", "Subscribers gained", "Likes", "Comments"]}
            rows={report.days.map((day) => [
              day.date,
              day.views,
              day.minutesWatched,
              day.subscribersGained,
              day.likes,
              day.comments,
            ])}
          />
        </div>
      )}
    </>
  );
}
