import { Link } from "react-router";
import { api } from "@convex/_generated/api";
import { useLive } from "./Live";

/** Live unread count. It ticks up the moment someone upvotes or pledges. */
export function NotificationsBell() {
  const unread = useLive(api.notifications.unreadCount, {}, 0);
  return (
    <Link
      to="/notifications"
      className="relative inline-flex size-9 items-center justify-center rounded-full border-2 border-ink bg-card hover:bg-wall-deep"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <span aria-hidden="true">🔔</span>
      {unread > 0 && (
        <span className="absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full border-2 border-ink bg-hot px-1 font-mono text-[0.6rem] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
