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
import { Bang } from "~/components/Logo";

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
    <section className="mx-auto max-w-2xl px-4 pt-14">
      <h1 className="title-1">Notifications</h1>
      <p className="mt-3 text-muted">Live. Votes, feedback and pledges land here the moment they happen.</p>
      <ol className="mt-10 grid gap-1">
        {items.length === 0 && (
          <EmptyState>Nothing yet. Throw something at the wall and people will start reacting.</EmptyState>
        )}
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={slopPath(item.ownerUsername, item.slop.slug)}
              className={`flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                item.read ? "hover:bg-sunk" : "bg-sunk hover:bg-line"
              }`}
            >
              {item.actor ? (
                <Avatar user={item.actor} size="sm" />
              ) : (
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-board">
                  <Bang className="h-5 w-auto" />
                </span>
              )}
              <span className={`min-w-0 flex-1 ${item.read ? "" : "font-bold"}`}>{describe(item)}</span>
              {!item.read && <span className="sr-only">Unread.</span>}
              <span className="shrink-0 text-sm text-muted">{timeAgo(item.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
