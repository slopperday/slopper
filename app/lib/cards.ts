import type { PublicSlop, PublicUser } from "@convex/lib/shape";
import type { DayState, GoalProgress } from "./goal";
import { slopPath } from "./display";

/**
 * Share cards: the images a link to a slop or a profile unfurls with
 * (app/.server/cards.tsx draws them). Their URLs carry a version of what the
 * card shows, so X, Slack and friends fetch a fresh card once it changes
 * instead of keeping their week-old copy.
 */

export const CARD_SIZE = { width: 1200, height: 630 } as const;

/** What a slop card shows: only public fields, so it never shows more than the page. */
export type SlopCardSlop = Pick<
  PublicSlop,
  | "name"
  | "tagline"
  | "launchLabel"
  | "number"
  | "goalDay"
  | "goalLength"
  | "upvotes"
  | "slopOfTheDay"
  | "slopcessfulAt"
>;

export interface ProfileCardData {
  displayName: string;
  username: string;
  slops: number;
  streak: number;
  daysWon: number;
  goal: { title: string; shipped: number; target: number; currentDay: number; days: DayState[] } | null;
}

/** What a profile card shows, from the profile page's data. An abandoned goal isn't shown. */
export function profileCardData(profile: {
  owner: Pick<PublicUser, "displayName" | "username">;
  totalShipped: number;
  streak: number;
  daysWon: number;
  progress: GoalProgress | null;
}): ProfileCardData {
  const { progress } = profile;
  return {
    displayName: profile.owner.displayName,
    username: profile.owner.username,
    slops: profile.totalShipped,
    streak: profile.streak,
    daysWon: profile.daysWon,
    goal:
      progress && progress.status !== "abandoned"
        ? {
            title: progress.goal.title,
            shipped: progress.shipped,
            target: progress.goal.target,
            currentDay: progress.currentDay,
            days: progress.days.map((day) => day.state),
          }
        : null,
  };
}

/** FNV-1a: short and stable; it only has to change when the card does. */
function version(value: unknown): string {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(value)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The screenshot a slop card shows: the cover, never one that's blurred as NSFW. */
export function slopCardScreenshot(slop: Pick<PublicSlop, "screenshots" | "nsfw">): string | null {
  return slop.nsfw ? null : (slop.screenshots[0] ?? null);
}

export function slopCardPath(username: string, slop: SlopCardSlop & Pick<PublicSlop, "slug" | "screenshots" | "nsfw">) {
  const shown: SlopCardSlop & { screenshot: string | null } = {
    name: slop.name,
    tagline: slop.tagline,
    launchLabel: slop.launchLabel,
    number: slop.number,
    goalDay: slop.goalDay,
    goalLength: slop.goalLength,
    upvotes: slop.upvotes,
    slopOfTheDay: slop.slopOfTheDay,
    slopcessfulAt: slop.slopcessfulAt,
    screenshot: slopCardScreenshot(slop),
  };
  return `${slopPath(username, slop.slug)}/card.png?v=${version(shown)}`;
}

export function profileCardPath(card: ProfileCardData): string {
  return `/@${card.username}/card.png?v=${version(card)}`;
}
