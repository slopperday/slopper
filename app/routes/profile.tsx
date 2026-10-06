import { Link } from "react-router";
import type { Route } from "./+types/profile";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { notFound } from "~/.server/http";
import { seo } from "~/lib/seo";
import { Avatar } from "~/components/Avatar";
import { GoalGrid } from "~/components/GoalGrid";
import { SlopGrid } from "~/components/SlopCard";
import { EmptyState } from "~/components/Shared";
import { useLive } from "~/components/Live";

export async function loader({ params, context }: Route.LoaderArgs) {
  if (!params.handle.startsWith("@")) notFound();
  const username = params.handle.slice(1).toLowerCase();
  const profile = await convex.query(api.users.profile, { username, asUser: context.get(viewerContext).user?._id });
  if (!profile) notFound();
  return { username, profile };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  if (!loaderData) return seo(matches);
  const { owner, totalShipped } = loaderData.profile;
  return seo(matches, {
    title: `${owner.displayName} (@${owner.username})`,
    description: owner.bio || `${totalShipped} slops thrown on Slopper.`,
    path: `/@${owner.username}`,
  });
};

export default function Profile({ loaderData }: Route.ComponentProps) {
  const profile =
    useLive(api.users.profile, { username: loaderData.username }, loaderData.profile) ?? loaderData.profile;
  const { isSelf, items, progress } = profile;
  const user = profile.owner;
  const stats = [
    { label: "Slops", value: String(profile.totalShipped) },
    { label: "Streak", value: profile.streak > 0 ? `🔥${profile.streak}` : "0" },
    { label: "Upvotes", value: String(profile.upvotes) },
    { label: "Days won", value: profile.daysWon > 0 ? `🏆${profile.daysWon}` : "0" },
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
              {profile.slopcessfulOnTry && (
                <p className="mt-3">
                  <span className="chip chip-gold">★ Slopcessful on slop #{profile.slopcessfulOnTry}</span>
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
        {progress ? (
          <div className="mt-10">
            <GoalGrid progress={progress} username={user.username} streak={profile.streak} />
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

        {profile.pastGoals.length > 0 && (
          <section className="mt-10">
            <h2 className="eyebrow">Past goals</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {profile.pastGoals.map((goal) => (
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
