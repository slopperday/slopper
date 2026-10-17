import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { launchTitle } from "~/lib/display";
import type { Flash } from "~/lib/model";
import { convex } from "./convex";
import { type ContentCheck, checkSlop } from "./moderation";
import { type AutopostOutcome, announce, summarize } from "./social/announce";

/** What followed a launch: the content check's verdict and, if asked for, the auto-post. */
export interface FinishedLaunch {
  /** Null when the check couldn't run. */
  check: ContentCheck | null;
  /** Null when no auto-post was asked for, or the check blocked the slop. */
  autopost: AutopostOutcome | null;
}

/**
 * What runs after every launch goes out, made now or scheduled: the content
 * check, then the auto-post unless the check blocked it.
 */
export async function finishLaunch(
  owner: Pick<Doc<"users">, "_id" | "username">,
  launch: { slopId: Id<"slops">; updateId: Id<"updates"> },
  launchNote: string,
  autopost: boolean,
): Promise<FinishedLaunch> {
  const check = await checkSlop(launch.slopId, launchNote);
  const posted =
    autopost && check?.verdict !== "blocked" ? await announce(owner, launch.slopId, launch.updateId) : null;
  return { check, autopost: posted };
}

/** The flash after a launch goes out. A mature screenshot blurs it whatever the launch check says. */
export function launchFlash(title: string, finished: FinishedLaunch, blurred: boolean): Flash {
  if (finished.check?.verdict === "blocked") {
    return { tone: "error", message: `${title} is waiting for a moderator.` };
  }
  const nsfw = finished.check?.verdict === "mature" || blurred ? " It's marked NSFW, so it's blurred." : "";
  const autoposted = finished.autopost ? summarize(finished.autopost) : "";
  return { tone: "success", message: `${title} is on the wall.${nsfw}${autoposted}` };
}

export interface ReleasedLaunch {
  slopId: Id<"slops">;
  slug: string;
  title: string;
  /** A mature screenshot blurred it as it went out. */
  blurred: boolean;
  finished: FinishedLaunch;
}

/**
 * Puts one of the owner's scheduled launches out now and finishes it. One
 * that already went out but wasn't checked and auto-posted yet (the app
 * server was unreachable at the time) is finished instead. Throws a
 * ConvexError when the id isn't theirs or there's nothing left to do.
 */
export async function releaseScheduled(
  owner: Pick<Doc<"users">, "_id" | "username">,
  id: string,
): Promise<ReleasedLaunch> {
  const claimed = await convex.mutation(api.schedule.claim, { id, userId: owner._id });
  if (claimed) {
    const slop = await convex.query(api.slops.getForServer, { slopId: claimed.slopId });
    if (!slop) throw new Error(`Scheduled launch ${id} went out as a slop that's gone.`);
    const finished = await finishLaunch(owner, claimed, claimed.launchNote, claimed.autopost);
    return { slopId: slop._id, slug: slop.slug, title: launchTitle(claimed), blurred: slop.nsfw, finished };
  }
  const out = await convex.mutation(api.schedule.releaseNow, { userId: owner._id, id });
  const finished = await finishLaunch(owner, out, out.launchNote, out.autopost);
  return { slopId: out.slopId, slug: out.slug, title: launchTitle(out), blurred: out.blurred, finished };
}
