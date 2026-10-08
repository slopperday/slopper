import { Link } from "react-router";
import { api } from "@convex/_generated/api";
import { Icon } from "./Icon";
import { useLive } from "./Live";

/** Live unread count. It ticks up the moment someone upvotes or pledges. */
export function NotificationsBell() {
  const unread = useLive(api.notifications.unreadCount, {}, 0);
  return (
    <Link
      to="/notifications"
      className="relative inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-sunk"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Icon name="bell" className="size-[1.35rem]" />
      {unread > 0 && (
        <span className="absolute top-1 right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-hot px-1 text-[0.6875rem] leading-none font-bold text-hot-ink tabular-nums">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
