import { useEffect } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/notifications";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { queryAsUser } from "~/.server/convex";
import { timeAgo } from "~/lib/dates";
import { launchTitle, slopPath } from "~/lib/display";
import { formatMoney } from "~/lib/money";
import { seo } from "~/lib/seo";
import { Avatar } from "~/components/Avatar";
import { useLive, useLiveClient } from "~/components/Live";
import { EmptyState } from "~/components/Shared";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  return { items: await queryAsUser(user._id, api.notifications.mine, {}) };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Notifications", noindex: true });

type Item = Route.ComponentProps["loaderData"]["items"][number];

function describe(item: Item): string {
  const title = launchTitle(item.slop);
  const who = item.actor ? `@${item.actor.username}` : "Someone";
  switch (item.kind) {
    case "upvote":
      return `${who} upvoted ${title}`;
    case "feedback":
      return `${who} left feedback on ${title}`;
    case "kudos":
      return `${who} says ${title} is good 🔥`;
    case "pledge":
      return `${who} pledged ${formatMoney(item.amount ?? 0, "USD")} to ${title}`;
    case "slop_of_the_day":
      return `🏆 ${title} won slop of the day`;
  }
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const items = useLive(api.notifications.mine, {}, loaderData.items);
  const client = useLiveClient();
  const hasUnread = items.some((item) => !item.read);

  // Seeing them is reading them.
  useEffect(() => {
    if (client && hasUnread) void client.mutation(api.notifications.markAllRead, {});
  }, [client, hasUnread]);

  return (
    <section className="mx-auto max-w-2xl px-4 py-12">
      <p className="eyebrow">Live</p>
      <h1 className="font-wide mt-2 text-4xl font-black">Notifications</h1>
      <ol className="mt-8 grid gap-2">
        {items.length === 0 && (
          <EmptyState>Nothing yet. Throw something at the wall and people will start reacting.</EmptyState>
        )}
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={slopPath(item.ownerUsername, item.slop.slug)}
              className={`flex items-center gap-3 rounded-xl border-2 border-ink px-4 py-3 hover:-translate-y-0.5 ${
                item.read ? "bg-card" : "bg-slop text-slop-ink"
              }`}
            >
              {item.actor ? <Avatar user={item.actor} size="sm" /> : <span className="text-2xl">🏆</span>}
              <span className="min-w-0 flex-1 text-sm font-semibold">{describe(item)}</span>
              <span className="font-mono text-[0.65rem] opacity-70">{timeAgo(item.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
