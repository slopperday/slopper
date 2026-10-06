import { Link } from "react-router";
import type { Route } from "./+types/profile";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import { resolveOwner } from "~/.server/routing";
import { listUserSlops } from "~/.server/db/slops";
import { listUserGoals } from "~/.server/db/goals";
import { toFeedItems } from "~/.server/feed";
import { slopperCard, toLaunches } from "~/.server/leaderboard";
import { goalProgress } from "~/lib/goal";
import { localDate } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { Avatar } from "~/components/Avatar";
import { GoalGrid } from "~/components/GoalGrid";
import { SlopGrid } from "~/components/SlopCard";
import { EmptyState } from "~/components/Shared";

export async function loader({ params, context }: Route.LoaderArgs) {
  const kv = await getKv();
  const viewer = context.get(viewerContext).user;
  const owner = await resolveOwner(kv, params.handle);
  const now = new Date();
  const [slops, goals] = await Promise.all([listUserSlops(kv, owner.id), listUserGoals(kv, owner.id)]);
  const isSelf = viewer?.id === owner.id;
  const visible = slops.filter((slop) => !slop.hidden || isSelf);
  const current = goals.find((goal) => !goal.abandonedAt) ?? null;
  const card = slopperCard(owner, visible, current, now);
  const launches = toLaunches(visible);
  const today = localDate(now, owner.timeZone);

  // "Slopcessful on slop #N": how many tries it took, counting from the first.
  const chronological = [...visible].reverse();
  const firstHit = chronological.findIndex((slop) => slop.slopcessfulAt);

  return {
    card,
    isSelf,
    items: await toFeedItems(kv, visible, viewer),
    upvotes: visible.reduce((sum, slop) => sum + slop.upvotes, 0),
    daysWon: visible.filter((slop) => slop.slopOfTheDay && !slop.hidden).length,
    slopcessfulOnTry: firstHit === -1 ? null : firstHit + 1,
    pastGoals: goals
      .filter((goal) => goal.id !== current?.id)
      .map((goal) => {
        const progress = goalProgress(goal, launches, today);
        return {
          id: goal.id,
          title: goal.title,
          shipped: progress.shipped,
          target: goal.target,
          status: progress.status,
        };
      }),
  };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  if (!loaderData) return seo(matches);
  const { user, totalShipped } = loaderData.card;
  return seo(matches, {
    title: `${user.displayName} (@${user.username})`,
    description: user.bio || `${totalShipped} slops thrown on Slopper.`,
    path: `/@${user.username}`,
  });
};

export default function Profile({ loaderData }: Route.ComponentProps) {
  const { card, isSelf, items } = loaderData;
  const user = card.user;
  const stats = [
    { label: "Slops", value: String(card.totalShipped) },
    { label: "Streak", value: card.streak > 0 ? `🔥${card.streak}` : "0" },
    { label: "Upvotes", value: String(loaderData.upvotes) },
    { label: "Days won", value: loaderData.daysWon > 0 ? `🏆${loaderData.daysWon}` : "0" },
  ];
  return (
    <>
      <section className="border-b-2 border-ink bg-wall-deep">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="flex flex-wrap items-center gap-6">
            <Avatar user={user} size="lg" />
            <div className="min-w-0">
              <h1 className="font-wide text-4xl leading-none font-black sm:text-5xl">{user.displayName}</h1>
              <p className="mt-2 font-mono text-sm text-muted">@{user.username}</p>
              {user.bio && <p className="mt-3 max-w-xl">{user.bio}</p>}
              {user.website && (
                <a
                  href={user.website}
                  target="_blank"
                  rel="noopener nofollow"
                  className="mt-2 inline-block text-sm font-bold underline decoration-slop-deep decoration-2"
                >
                  {new URL(user.website).hostname}
                </a>
              )}
              {loaderData.slopcessfulOnTry && (
                <p className="mt-3">
                  <span className="chip chip-gold">★ Slopcessful on slop #{loaderData.slopcessfulOnTry}</span>
                </p>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-xl border-2 border-ink bg-card px-4 py-3 text-center">
                <dt className="eyebrow">{stat.label}</dt>
                <dd className="font-wide text-3xl font-black tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4">
        {card.progress ? (
          <div className="mt-10">
            <GoalGrid progress={card.progress} username={user.username} streak={card.streak} />
          </div>
        ) : (
          isSelf && (
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-ink p-6">
              <p className="font-bold">No goal running.</p>
              <Link to="/goal" className="btn btn-slop btn-sm">
                Set one
              </Link>
            </div>
          )
        )}

        {loaderData.pastGoals.length > 0 && (
          <section className="mt-10">
            <h2 className="eyebrow">Past goals</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {loaderData.pastGoals.map((goal) => (
                <li key={goal.id} className="chip px-3 py-1">
                  {goal.title}: {goal.shipped}/{goal.target}
                  {goal.status === "won" ? " ✓" : goal.status === "abandoned" ? " ✕" : ""}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-wide text-3xl font-black">{isSelf ? "Your slops" : "Slops"}</h2>
            {isSelf && (
              <Link to="/new" className="btn btn-slop btn-sm">
                + New slop
              </Link>
            )}
          </div>
          <div className="mt-10">
            {items.length > 0 ? (
              <SlopGrid items={items} />
            ) : (
              <EmptyState>
                {isSelf ? "Nothing thrown yet. Today's a good day for it." : "Nothing thrown yet."}
              </EmptyState>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
