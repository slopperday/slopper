import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AuthProviderId, Flash } from "~/lib/model";
import type { OAuthClientCredentials } from "../config";
import { convex } from "../convex";
import type { TokenSet } from "../auth/oauth";
import { fetchLinkedInProfile } from "./adapters";
import {
  type DiscordCredentials,
  fetchDiscordWebhook,
  fetchMastodonAccount,
  fetchRedditSubreddit,
  fetchTelegramChannel,
  type MastodonCredentials,
  type RedditCredentials,
  type TelegramCredentials,
} from "./community";
import { sealCredentials } from "./core";
import {
  fetchMetaPages,
  fetchMetaPagesFromToken,
  fetchThreadsFromToken,
  fetchThreadsProfile,
  type InstagramCredentials,
  type MetaPage,
  type PageCredentials,
} from "./meta";
import { fetchTikTokProfile, type TikTokCredentials } from "./tiktok";
import { fetchYouTubeChannel, type YouTubeCredentials } from "./youtube";

async function storeMetaPages(
  userId: Id<"users">,
  pages: readonly MetaPage[],
  organizationId?: string,
): Promise<Flash> {
  let instagram = 0;
  for (const page of pages) {
    const credentials: PageCredentials = { kind: "facebook-page", pageId: page.id, pageToken: page.accessToken };
    await convex.mutation(api.accounts.connect, {
      userId,
      provider: "facebook",
      remoteId: page.id,
      handle: page.name,
      displayName: page.name,
      avatarUrl: page.picture,
      sealedCredentials: await sealCredentials(credentials),
      expiresAt: null,
      initialMode: "off",
      brand: page.name,
      organizationId,
    });
    if (page.instagram) {
      instagram++;
      const ig: InstagramCredentials = {
        kind: "instagram",
        igUserId: page.instagram.id,
        pageToken: page.accessToken,
      };
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "instagram",
        remoteId: page.instagram.id,
        handle: page.instagram.username,
        displayName: page.instagram.name,
        avatarUrl: page.instagram.picture,
        sealedCredentials: await sealCredentials(ig),
        expiresAt: null,
        initialMode: "off",
        brand: page.name,
        organizationId,
      });
    }
  }
  if (pages.length === 0) {
    return {
      tone: "error",
      message: "Facebook didn't share any Pages. Connect again and tick the Pages you want to post as.",
    };
  }
  const pageWord = pages.length === 1 ? "1 Page" : `${pages.length} Pages`;
  const igWord =
    instagram === 0 ? "" : instagram === 1 ? " and 1 Instagram account" : ` and ${instagram} Instagram accounts`;
  return { tone: "success", message: `Connected ${pageWord}${igWord}. Each is grouped under its Page's name.` };
}

/**
 * Connecting the studio's networks after their OAuth dance. X and LinkedIn
 * are in the callback route itself, from before the studio.
 *
 * Every account connected here starts Off for launch auto-posts: a new
 * brand's Page or channel never gets another product's launches until its
 * owner turns it on. The studio can post with it at once.
 */
export async function connectExtraNetwork(
  provider: AuthProviderId,
  client: OAuthClientCredentials,
  tokens: TokenSet,
  userId: Id<"users">,
): Promise<Flash | null> {
  switch (provider) {
    case "google": {
      if (!tokens.refreshToken) {
        return { tone: "error", message: "Google didn't let Slopper keep posting. Try connecting again." };
      }
      const channel = await fetchYouTubeChannel(tokens.accessToken);
      const credentials: YouTubeCredentials = {
        kind: "youtube",
        channelId: channel.id,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      };
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "youtube",
        remoteId: channel.id,
        handle: channel.handle.replace(/^@/, ""),
        displayName: channel.title,
        avatarUrl: channel.avatarUrl,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        initialMode: "off",
      });
      return { tone: "success", message: `Connected ${channel.title} on YouTube.` };
    }

    case "facebook": {
      const pages = await fetchMetaPages(tokens.accessToken, client.clientId, client.clientSecret);
      return await storeMetaPages(userId, pages);
    }

    case "tiktok": {
      if (!tokens.refreshToken || !tokens.expiresAt) {
        return { tone: "error", message: "TikTok didn't let Slopper keep posting. Try connecting again." };
      }
      const user = await fetchTikTokProfile(tokens.accessToken);
      const credentials: TikTokCredentials = {
        kind: "tiktok",
        openId: user.open_id,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      };
      const handle = user.username ?? user.display_name ?? "TikTok account";
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "tiktok",
        remoteId: user.open_id,
        handle,
        displayName: user.display_name ?? handle,
        avatarUrl: user.avatar_url ?? null,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        initialMode: "off",
      });
      return { tone: "success", message: `Connected @${handle} on TikTok.` };
    }

    case "threads": {
      const { profile, credentials } = await fetchThreadsProfile(tokens.accessToken, client.clientSecret);
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "threads",
        remoteId: profile.id,
        handle: profile.username,
        displayName: profile.name ?? profile.username,
        avatarUrl: profile.threads_profile_picture_url ?? null,
        sealedCredentials: await sealCredentials(credentials),
        // Refreshed as it's used (`freshThreadsToken`), so it isn't shown as expiring.
        expiresAt: null,
        initialMode: "off",
      });
      return { tone: "success", message: `Connected @${profile.username} on Threads.` };
    }

    default:
      return null;
  }
}

/**
 * Connects Facebook & Instagram, YouTube, TikTok, Threads, or LinkedIn using
 * the person's own developer access token when they bring their own app keys.
 */
export async function connectWithOwnToken(
  network: string,
  accessToken: string,
  refreshToken: string,
  userId: Id<"users">,
  options?: { brand?: string; organizationId?: string },
): Promise<Flash> {
  const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const brand = options?.brand?.trim() || undefined;
  const organizationId = options?.organizationId?.trim() || undefined;
  switch (network) {
    case "meta": {
      const pages = await fetchMetaPagesFromToken(accessToken);
      return await storeMetaPages(userId, pages, organizationId);
    }
    case "youtube": {
      const channel = await fetchYouTubeChannel(accessToken);
      const credentials: YouTubeCredentials = {
        kind: "youtube",
        channelId: channel.id,
        accessToken,
        refreshToken: refreshToken || accessToken,
        expiresAt: refreshToken ? null : farFuture,
      };
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "youtube",
        remoteId: channel.id,
        handle: channel.handle.replace(/^@/, ""),
        displayName: channel.title,
        avatarUrl: channel.avatarUrl,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        initialMode: "off",
        brand,
        organizationId,
      });
      return { tone: "success", message: `Connected ${channel.title} on YouTube.` };
    }
    case "tiktok": {
      const user = await fetchTikTokProfile(accessToken);
      const credentials: TikTokCredentials = {
        kind: "tiktok",
        openId: user.open_id,
        accessToken,
        refreshToken: refreshToken || accessToken,
        expiresAt: farFuture,
      };
      const handle = user.username ?? user.display_name ?? "TikTok account";
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "tiktok",
        remoteId: user.open_id,
        handle,
        displayName: user.display_name ?? handle,
        avatarUrl: user.avatar_url ?? null,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        initialMode: "off",
        brand,
        organizationId,
      });
      return { tone: "success", message: `Connected @${handle} on TikTok.` };
    }
    case "threads": {
      const { profile, credentials } = await fetchThreadsFromToken(accessToken);
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "threads",
        remoteId: profile.id,
        handle: profile.username,
        displayName: profile.name ?? profile.username,
        avatarUrl: profile.threads_profile_picture_url ?? null,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        initialMode: "off",
        brand,
        organizationId,
      });
      return { tone: "success", message: `Connected @${profile.username} on Threads.` };
    }
    case "linkedin": {
      const profile = await fetchLinkedInProfile(accessToken);
      const account = await convex.mutation(api.accounts.connect, {
        userId,
        provider: "linkedin",
        remoteId: profile.sub,
        handle: profile.name ?? profile.given_name ?? "LinkedIn member",
        displayName: profile.name ?? "LinkedIn member",
        avatarUrl: profile.picture ?? null,
        sealedCredentials: await sealCredentials({
          accessToken,
          expiresAt: null,
          personUrn: `urn:li:person:${profile.sub}`,
        }),
        expiresAt: null,
        brand,
        organizationId,
      });
      return { tone: "success", message: `Connected ${account.displayName} on LinkedIn.` };
    }
    default:
      return { tone: "error", message: "Unknown network." };
  }
}

/**
 * Connects Mastodon, Discord, Telegram, or Reddit accounts. Multiple accounts
 * per network can be added by connecting different instances, webhooks, channels,
 * or subreddits.
 */
export async function connectCommunityNetwork(
  network: "mastodon" | "discord" | "telegram" | "reddit",
  fields: {
    service?: string;
    accessToken?: string;
    webhookUrl?: string;
    botToken?: string;
    chatId?: string;
    subreddit?: string;
    brand?: string;
    organizationId?: string;
  },
  userId: Id<"users">,
): Promise<Flash> {
  const brand = fields.brand?.trim() || undefined;
  const organizationId = fields.organizationId?.trim() || undefined;

  switch (network) {
    case "mastodon": {
      const accessToken = (fields.accessToken ?? "").trim();
      if (!accessToken) return { tone: "error", message: "Paste your Mastodon access token." };
      const account = await fetchMastodonAccount(fields.service ?? "https://mastodon.social", accessToken);
      const credentials: MastodonCredentials = {
        kind: "mastodon",
        service: account.service,
        accessToken,
      };
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "mastodon",
        remoteId: `${account.service}#${account.id}`,
        handle: account.handle,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        brand,
        organizationId,
      });
      return { tone: "success", message: `Connected @${account.handle} on Mastodon.` };
    }

    case "discord": {
      const webhookUrl = (fields.webhookUrl ?? "").trim();
      if (!webhookUrl) return { tone: "error", message: "Paste your Discord channel webhook URL." };
      const hook = await fetchDiscordWebhook(webhookUrl);
      const credentials: DiscordCredentials = {
        kind: "discord",
        webhookUrl: hook.webhookUrl,
        channelId: hook.channelId,
        guildId: hook.guildId,
      };
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "discord",
        remoteId: hook.id,
        handle: hook.name,
        displayName: hook.name,
        avatarUrl: hook.avatarUrl,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        brand,
        organizationId,
      });
      return { tone: "success", message: `Connected ${hook.name} on Discord.` };
    }

    case "telegram": {
      const botToken = (fields.botToken ?? "").trim();
      const chatId = (fields.chatId ?? "").trim();
      const channel = await fetchTelegramChannel(botToken, chatId);
      const credentials: TelegramCredentials = {
        kind: "telegram",
        botToken: channel.botToken,
        chatId: channel.chatId,
        handle: channel.handle,
      };
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "telegram",
        remoteId: channel.chatId,
        handle: channel.handle,
        displayName: channel.displayName,
        avatarUrl: null,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        brand,
        organizationId,
      });
      return { tone: "success", message: `Connected ${channel.displayName} on Telegram.` };
    }

    case "reddit": {
      const subreddit = (fields.subreddit ?? "").trim();
      const accessToken = (fields.accessToken ?? "").trim();
      if (!subreddit || !accessToken) {
        return { tone: "error", message: "Enter both the subreddit and a Reddit OAuth access token." };
      }
      const sub = await fetchRedditSubreddit(subreddit, accessToken);
      const credentials: RedditCredentials = {
        kind: "reddit",
        subreddit: sub.subreddit,
        accessToken,
      };
      await convex.mutation(api.accounts.connect, {
        userId,
        provider: "reddit",
        remoteId: sub.id,
        handle: sub.handle,
        displayName: sub.displayName,
        avatarUrl: sub.avatarUrl,
        sealedCredentials: await sealCredentials(credentials),
        expiresAt: null,
        brand,
        organizationId,
      });
      return { tone: "success", message: `Connected ${sub.handle} on Reddit.` };
    }
  }
}
