import { launchTitle } from "./display";
import { formatMoney } from "./money";

/** Shared by the notifications page and browser notifications, so both say the same thing. */

export type NotificationKind = "upvote" | "feedback" | "kudos" | "pledge" | "slop_of_the_day";

export interface NotificationFacts {
  kind: NotificationKind;
  /** Who did it. Null for Slopper itself (slop of the day) or a person who's gone. */
  actorUsername: string | null;
  slop: { name: string; launchLabel: string | null };
  /** Pledges only, in cents. */
  amount: number | null;
}

export function notificationText({ kind, actorUsername, slop, amount }: NotificationFacts): string {
  const title = launchTitle(slop);
  const who = actorUsername ? `@${actorUsername}` : "Someone";
  switch (kind) {
    case "upvote":
      return `${who} upvoted ${title}`;
    case "feedback":
      return `${who} left feedback on ${title}`;
    case "kudos":
      return `${who} says ${title} is good 🔥`;
    case "pledge":
      return `${who} pledged ${formatMoney(amount ?? 0, "USD")} to ${title}`;
    case "slop_of_the_day":
      return `🏆 ${title} won slop of the day`;
  }
}
