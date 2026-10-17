import type { Doc } from "@convex/_generated/dataModel";
import type { PublicSlop } from "@convex/lib/shape";
import type { CrosspostMode, CrosspostResult, SocialProvider, UpdateDetails, UpdateKind } from "~/lib/model";
import { FIELD_OUTCOMES, UPDATE_KINDS } from "~/lib/model";
import { slopPath } from "~/lib/display";
import { markdownToPlain, type PostContent } from "~/lib/compose";
import { absoluteUrl } from "../config";
import { type ConnectedAccount, type PublishedPost, type SocialAdapter, SocialError } from "./adapters";

export interface CrosspostPlan {
  account: ConnectedAccount;
  mode: Exclude<CrosspostMode, "off">;
}

export function modeFor(slop: Pick<Doc<"slops">, "crosspost">, account: ConnectedAccount): CrosspostMode {
  return slop.crosspost[account._id] ?? account.defaultMode;
}

/** Posting accounts go first so reposting accounts have something to repost. */
export function planCrossposts(
  slop: Pick<Doc<"slops">, "crosspost">,
  accounts: readonly ConnectedAccount[],
): CrosspostPlan[] {
  const plans: CrosspostPlan[] = [];
  for (const account of accounts) {
    const mode = modeFor(slop, account);
    if (mode !== "off") plans.push({ account, mode });
  }
  return plans.sort((a, b) => (a.mode === "post" ? 0 : 1) - (b.mode === "post" ? 0 : 1));
}

type Postable = Pick<
  PublicSlop,
  "name" | "tagline" | "slug" | "goalDay" | "goalLength" | "launchLabel" | "screenshots"
>;

/** What the owner is announcing, in plain text, before network fitting. */
export function buildPostContent(
  slop: Postable,
  update: { kind: UpdateKind; body: string; version?: string | null; details?: UpdateDetails | null },
  username: string,
): PostContent {
  const note = markdownToPlain(update.body);
  let text: string;
  if (update.kind === "launch") {
    const day = slop.goalDay && slop.goalLength ? `Day ${slop.goalDay}/${slop.goalLength} · ` : "";
    const what = slop.launchLabel ? `${slop.name} (${slop.launchLabel})` : slop.name;
    text = `${day}Just slopped ${what}: ${slop.tagline}`;
    if (note && note !== slop.tagline) text += `\n\n${note}`;
  } else {
    const name = update.version ? `${slop.name} ${update.version}` : slop.name;
    const details = update.details;
    const what =
      details?.kind === "feature"
        ? `: ${details.name}`
        : details?.kind === "field"
          ? ` (${FIELD_OUTCOMES[details.outcome].label.toLowerCase()})`
          : "";
    text = `${name} · ${UPDATE_KINDS[update.kind].label}${what}\n\n${note}`;
  }
  return {
    text,
    url: absoluteUrl(slopPath(username, slop.slug)),
    title: slop.launchLabel ? `${slop.name} · ${slop.launchLabel}` : slop.name,
    description: slop.tagline,
    imageUrl: slop.screenshots[0] ?? null,
  };
}

/** What the maker sees for a failed post: a network's refusal as it was worded, anything else plainly. */
function describeError(error: unknown): string {
  if (error instanceof SocialError) return error.message;
  console.error("Posting failed", error);
  return "Something went wrong. Try again later.";
}

/**
 * Publishes with every "post" account, then reposts the first post on each
 * network with that network's "amplify" accounts. Failures are recorded per
 * account and never stop the others.
 */
export async function runCrossposts(
  plans: readonly CrosspostPlan[],
  content: PostContent,
  adapters: Record<SocialProvider, SocialAdapter>,
): Promise<CrosspostResult[]> {
  const results: CrosspostResult[] = [];
  const firstPost = new Map<SocialProvider, PublishedPost>();

  for (const { account, mode } of plans) {
    const base = { accountId: account._id, provider: account.provider, handle: account.handle, mode };
    const adapter = adapters[account.provider];
    const at = () => new Date().toISOString();

    if (mode === "post") {
      try {
        const post = await adapter.publish(account, content);
        if (!firstPost.has(account.provider)) firstPost.set(account.provider, post);
        results.push({ ...base, status: "ok", url: post.url, message: null, at: at() });
      } catch (error) {
        results.push({ ...base, status: "error", url: null, message: describeError(error), at: at() });
      }
      continue;
    }

    const original = firstPost.get(account.provider);
    if (!adapter.amplify) {
      results.push({ ...base, status: "skipped", url: null, message: "This network doesn't do reposts.", at: at() });
    } else if (!original) {
      results.push({ ...base, status: "skipped", url: null, message: "No post on this network to repost.", at: at() });
    } else {
      try {
        await adapter.amplify(account, original);
        results.push({ ...base, status: "ok", url: original.url, message: null, at: at() });
      } catch (error) {
        results.push({ ...base, status: "error", url: null, message: describeError(error), at: at() });
      }
    }
  }
  return results;
}
