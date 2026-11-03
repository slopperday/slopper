import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AuthProviderId, Flash } from "~/lib/model";
import type { OAuthClientCredentials } from "../config";
import { convex } from "../convex";
import type { TokenSet } from "../auth/oauth";
import { sealCredentials } from "./core";
import { fetchMetaPages, fetchThreadsProfile, type InstagramCredentials, type PageCredentials } from "./meta";
import { fetchTikTokProfile, type TikTokCredentials } from "./tiktok";
import { fetchYouTubeChannel, type YouTubeCredentials } from "./youtube";

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
