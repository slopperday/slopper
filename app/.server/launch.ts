import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { launchTitle } from "~/lib/display";
import type { Flash } from "~/lib/model";
import { convex } from "./convex";
import { type ContentCheck, checkSlop } from "./moderation";
import { type AutopostOutcome, announce, summarize } from "./social/announce";

/** What followed a launch: the content check's verdict and, if asked for, the auto-post. */
export interface FinishedLaunch {
  /** Null when checking failed or its verdict no longer matched. */
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
  autopost: boolean,
): Promise<FinishedLaunch> {
  const check = await checkSlop(launch.slopId);
  const posted =
    autopost && check && check.verdict !== "blocked" ? await announce(owner, launch.slopId, launch.updateId) : null;
  return { check, autopost: posted };
}

/** The flash after a launch goes out. A mature screenshot blurs it whatever the launch check says. */
export function launchFlash(title: string, finished: FinishedLaunch, blurred: boolean): Flash {
  if (!finished.check) {
    return { tone: "error", message: `${title} is saved and waiting for a content check. Only you can see it.` };
  }
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

/** Finishes a leased release, retaining failed checks for Convex's backstop. */
export async function finishScheduled(
  owner: Pick<Doc<"users">, "_id" | "username">,
  id: string,
  claimed: {
    slopId: Id<"slops">;
    updateId: Id<"updates">;
    claimVersion: number;
    autopost: boolean;
  },
): Promise<FinishedLaunch> {
  const finished = await finishLaunch(owner, claimed, claimed.autopost);
  await convex.mutation(api.schedule.complete, {
    id,
    claimVersion: claimed.claimVersion,
    checked: finished.check !== null,
  });
  return finished;
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
    const finished = await finishScheduled(owner, id, claimed);
    return { slopId: slop._id, slug: slop.slug, title: launchTitle(claimed), blurred: slop.nsfw, finished };
  }
  const out = await convex.mutation(api.schedule.releaseNow, { userId: owner._id, id });
  const finished = await finishScheduled(owner, id, out);
  return { slopId: out.slopId, slug: out.slug, title: launchTitle(out), blurred: out.blurred, finished };
}
