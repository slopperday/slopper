import { Link } from "react-router";
import type { Route } from "./+types/profile";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { notFound } from "~/.server/http";
import { seo } from "~/lib/seo";
import { Avatar } from "~/components/Avatar";
import { GoalGrid } from "~/components/GoalGrid";
import { SlopList } from "~/components/SlopList";
import { EmptyState } from "~/components/Shared";
import { Icon } from "~/components/Icon";
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
    { label: "Slops", value: profile.totalShipped },
    { label: "Streak", value: profile.streak },
    { label: "Upvotes", value: profile.upvotes },
    { label: "Days won", value: profile.daysWon },
  ];
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="flex flex-wrap items-center gap-6">
            <Avatar user={user} size="lg" />
            <div className="min-w-0">
              <h1 className="title-1 break-words">{user.displayName}</h1>
              <p className="mt-2 text-muted">@{user.username}</p>
              {user.bio && <p className="mt-3 max-w-xl text-[1.125rem]">{user.bio}</p>}
              {user.website && (
                <a href={user.website} target="_blank" rel="noopener nofollow" className="link mt-2 inline-block">
                  {new URL(user.website).hostname}
                </a>
              )}
              {profile.slopcessfulOnTry && (
                <p className="mt-3">
                  <span className="tag tag-gold">
                    <Icon name="star" filled className="size-3.5 text-gold-text" />
                    Slopcessful on slop #{profile.slopcessfulOnTry}
                  </span>
                </p>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-4 gap-x-6 sm:gap-x-8">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse justify-end">
                <dt className="text-sm text-muted">{stat.label}</dt>
                <dd className="font-display text-[2.6rem] leading-none font-black tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4">
        {progress ? (
          <div className="mt-12">
            <GoalGrid progress={progress} username={user.username} streak={profile.streak} />
          </div>
        ) : (
          isSelf && (
            <div className="panel mt-12 flex flex-wrap items-center justify-between gap-4">
              <p className="font-bold">No goal running.</p>
              <Link to="/goal" className="btn btn-slop btn-sm">
                Set one
              </Link>
            </div>
          )
        )}

        {profile.pastGoals.length > 0 && (
          <section className="mt-12">
            <h2 className="caps">Past goals</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {profile.pastGoals.map((goal) => (
                <li key={goal.id} className="tag px-2.5 py-1 text-[0.9375rem]">
                  {goal.title}: {goal.shipped}/{goal.target}
                  {goal.status === "won" && <Icon name="check" className="size-4 text-slop-text" />}
                  {goal.status === "abandoned" && <Icon name="close" className="size-4 text-muted" />}
                  {goal.status === "won" ? <span className="sr-only">, goal hit</span> : null}
                  {goal.status === "abandoned" ? <span className="sr-only">, abandoned</span> : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-20">
          <div className="flex items-end justify-between gap-4">
            <h2 className="title-2">{isSelf ? "Your slops" : "Slops"}</h2>
            {isSelf && (
              <Link to="/new" className="btn btn-slop btn-sm">
                <Icon name="plus" className="size-4" /> New slop
              </Link>
            )}
          </div>
          <div className="mt-10">
            {items.length > 0 ? (
              <SlopList items={items} />
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
