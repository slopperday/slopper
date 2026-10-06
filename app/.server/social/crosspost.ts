import type { ConnectedAccount, CrosspostMode, CrosspostResult, Slop, SlopUpdate, SocialProvider } from "~/lib/model";
import { UPDATE_KINDS } from "~/lib/model";
import { absoluteUrl } from "../config";
import { slopPath } from "~/lib/display";
import { markdownToPlain, type PostContent } from "~/lib/compose";
import type { PublishedPost, SocialAdapter } from "./adapters";

export interface CrosspostPlan {
  account: ConnectedAccount;
  mode: Exclude<CrosspostMode, "off">;
}

export function modeFor(slop: Pick<Slop, "crosspost">, account: ConnectedAccount): CrosspostMode {
  return slop.crosspost[account.id] ?? account.defaultMode;
}

/** Posting accounts go first so amplifiers have something to repost. */
export function planCrossposts(slop: Pick<Slop, "crosspost">, accounts: readonly ConnectedAccount[]): CrosspostPlan[] {
  const plans: CrosspostPlan[] = [];
  for (const account of accounts) {
    const mode = modeFor(slop, account);
    if (mode !== "off") plans.push({ account, mode });
  }
  return plans.sort((a, b) => (a.mode === "post" ? 0 : 1) - (b.mode === "post" ? 0 : 1));
}

/** What the owner is announcing, in plain text, before network fitting. */
export function buildPostContent(slop: Slop, update: SlopUpdate, username: string): PostContent {
  const note = markdownToPlain(update.body);
  let text: string;
  if (update.kind === "launch") {
    const day = slop.goalDay && slop.goalLength ? `Day ${slop.goalDay}/${slop.goalLength} · ` : "";
    text = `${day}Just slopped ${slop.name}: ${slop.tagline}`;
    if (note && note !== slop.tagline) text += `\n\n${note}`;
  } else {
    text = `${slop.name} · ${UPDATE_KINDS[update.kind].label}\n\n${note}`;
  }
  return {
    text,
    url: absoluteUrl(slopPath(username, slop.slug)),
    title: slop.name,
    description: slop.tagline,
    imageMediaId: slop.screenshots[0] ?? null,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const base = {
      accountId: account.id,
      provider: account.provider,
      handle: account.handle,
      mode,
    };
    const adapter = adapters[account.provider];
    const at = () => new Date().toISOString();

    if (mode === "post") {
      try {
        const post = await adapter.publish(account, content);
        if (!firstPost.has(account.provider)) {
          firstPost.set(account.provider, post);
        }
        results.push({
          ...base,
          status: "ok",
          url: post.url,
          message: null,
          at: at(),
        });
      } catch (error) {
        results.push({
          ...base,
          status: "error",
          url: null,
          message: describeError(error),
          at: at(),
        });
      }
      continue;
    }

    const original = firstPost.get(account.provider);
    if (!adapter.amplify) {
      results.push({
        ...base,
        status: "skipped",
        url: null,
        message: "This network has no repost API.",
        at: at(),
      });
    } else if (!original) {
      results.push({
        ...base,
        status: "skipped",
        url: null,
        message: "No post on this network to repost.",
        at: at(),
      });
    } else {
      try {
        await adapter.amplify(account, original);
        results.push({
          ...base,
          status: "ok",
          url: original.url,
          message: null,
          at: at(),
        });
      } catch (error) {
        results.push({
          ...base,
          status: "error",
          url: null,
          message: describeError(error),
          at: at(),
        });
      }
    }
  }
  return results;
}
