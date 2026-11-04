import { api } from "@convex/_generated/api";
import { clientCredentials, refreshTokens } from "../auth/oauth";
import { convex } from "../convex";
import {
  type ConnectedAccount,
  count,
  type Draft,
  loadMedia,
  okJson,
  openCredentials,
  type PostMetrics,
  type SendResult,
  type SocialAdapter,
  SocialError,
  sealCredentials,
} from "./core";

/**
 * YouTube, through a Google login that picks one channel (a brand account
 * is its own channel). Uploads use the Data API's resumable upload; stats
 * come from the Data API (per video) and the Analytics API (per channel).
 *
 * Google's videos.insert reference (checked November 2026): uploads from
 * unverified projects are not restricted to private, and each upload costs
 * 1 unit from a separate Video Uploads bucket of 100 a day. More needs
 * Google's quota audit, so plan for it before offering YouTube widely.
 */

const DATA = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

/** Scopes asked for when connecting a channel. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

export interface YouTubeCredentials {
  kind: "youtube";
  channelId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
}

async function freshToken(account: ConnectedAccount): Promise<string> {
  const credentials = await openCredentials<YouTubeCredentials>(account);
  const expiresAt = credentials.expiresAt ? Date.parse(credentials.expiresAt) : 0;
  if (expiresAt - Date.now() > 120_000) return credentials.accessToken;
  const client = clientCredentials("google");
  if (!client) throw new SocialError("YouTube isn't set up on this server any more.");
  const tokens = await refreshTokens("google", client, credentials.refreshToken).catch(() => {
    throw new SocialError("Google signed this channel out. Reconnect it.");
  });
  const next: YouTubeCredentials = { ...credentials, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
  await convex.mutation(api.accounts.storeCredentials, {
    accountId: account._id,
    sealedCredentials: await sealCredentials(next),
  });
  return next.accessToken;
}

async function get<T>(token: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  return await okJson<T>(response, "YouTube");
}

/** YouTube refuses < and > in titles and descriptions. */
function clean(text: string): string {
  return text.replace(/[<>]/g, "");
}

export function youtubeAdapter(): SocialAdapter {
  return {
    async publish() {
      throw new SocialError("YouTube needs a video. Post it from the studio.");
    },
    async send(account, draft: Draft): Promise<SendResult> {
      const video = draft.media.find((media) => media.kind === "video");
      if (!video) throw new SocialError("YouTube needs a video.");
      const options = draft.options.youtube;
      if (!options?.title.trim()) throw new SocialError("Give the YouTube video a title.");
      const token = await freshToken(account);
      const bytes = await loadMedia(video);
      const start = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(bytes.byteLength),
          "x-upload-content-type": video.contentType,
        },
        body: JSON.stringify({
          snippet: { title: clean(options.title).slice(0, 100), description: clean(draft.text).slice(0, 5000) },
          status: { privacyStatus: options.privacy, selfDeclaredMadeForKids: options.madeForKids },
        }),
      });
      await okJson<unknown>(start, "YouTube");
      const session = start.headers.get("location");
      if (!session) throw new SocialError("YouTube didn't start the upload. Try again.");
      // From here the upload can land even if the answer is lost, so failures are uncertain.
      const upload = await fetch(session, {
        method: "PUT",
        headers: { "content-type": video.contentType, "content-length": String(bytes.byteLength) },
        body: bytes,
        signal: AbortSignal.timeout(600_000),
      }).catch(() => {
        throw new SocialError(
          "The upload to YouTube was cut off. Check the channel before you retry.",
          undefined,
          true,
        );
      });
      const { id } = await okJson<{ id: string }>(upload, "YouTube");
      if (draft.thumbnailUrl) {
        // A custom thumbnail is a nicety: the video is up either way.
        const image = await fetch(draft.thumbnailUrl).catch(() => null);
        if (image?.ok) {
          const set = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": image.headers.get("content-type") ?? "image/jpeg",
            },
            body: new Uint8Array(await image.arrayBuffer()),
          });
          if (!set.ok) console.warn(`YouTube refused the thumbnail (${set.status})`);
        }
      }
      const short = (video.duration ?? Infinity) <= 180 && (video.height ?? 0) > (video.width ?? 0);
      return {
        status: "ok",
        post: {
          provider: "youtube",
          remoteId: id,
          url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
        },
      };
    },
    async comments(account, post) {
      const token = await freshToken(account);
      const { items } = await get<{
        items?: {
          id: string;
          snippet?: {
            topLevelComment?: {
              snippet?: { authorDisplayName?: string; textOriginal?: string; publishedAt?: string };
            };
          };
        }[];
      }>(token, `${DATA}/commentThreads?part=snippet&maxResults=25&videoId=${encodeURIComponent(post.remoteId)}`);
      return (items ?? []).map((item) => {
        const comment = item.snippet?.topLevelComment?.snippet;
        return {
          id: item.id,
          author: comment?.authorDisplayName ?? "someone",
          text: comment?.textOriginal ?? "",
          at: comment?.publishedAt ?? null,
        };
      });
    },
    async metrics(account, posts) {
      const token = await freshToken(account);
      const found = new Map<string, PostMetrics>();
      for (let i = 0; i < posts.length; i += 50) {
        const ids = posts.slice(i, i + 50).map((post) => post.remoteId);
        const { items } = await get<{ items?: { id: string; statistics?: Record<string, string> }[] }>(
          token,
          `${DATA}/videos?part=statistics&id=${ids.map(encodeURIComponent).join(",")}`,
        );
        for (const item of items ?? []) {
          found.set(item.id, {
            views: count(item.statistics?.viewCount),
            likes: count(item.statistics?.likeCount),
            comments: count(item.statistics?.commentCount),
          });
        }
      }
      return found;
    },
  };
}

/** The channel a Google token picked, when connecting. */
export async function fetchYouTubeChannel(accessToken: string) {
  const { items } = await get<{
    items?: {
      id: string;
      snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
    }[];
  }>(accessToken, `${DATA}/channels?part=snippet&mine=true`);
  const channel = items?.[0];
  if (!channel) throw new SocialError("That Google account has no YouTube channel yet. Create one, then connect.");
  return {
    id: channel.id,
    title: channel.snippet.title,
    handle: channel.snippet.customUrl ?? channel.snippet.title,
    avatarUrl: channel.snippet.thumbnails?.default?.url ?? null,
  };
}

export interface ChannelReport {
  subscribers: number | null;
  totalViews: number | null;
  videos: number | null;
  days: {
    date: string;
    views: number;
    minutesWatched: number;
    subscribersGained: number;
    subscribersLost: number;
    likes: number;
    comments: number;
  }[];
}

const DAY_METRICS = "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments";

/** A channel's day-by-day numbers from YouTube Analytics, with its running totals. */
export async function channelReport(account: ConnectedAccount, from: string, to: string): Promise<ChannelReport> {
  const token = await freshToken(account);
  const [channels, report] = await Promise.all([
    get<{ items?: { statistics?: Record<string, string> }[] }>(token, `${DATA}/channels?part=statistics&mine=true`),
    get<{ columnHeaders: { name: string }[]; rows?: (string | number)[][] }>(
      token,
      `${ANALYTICS}?ids=channel%3D%3DMINE&startDate=${from}&endDate=${to}&metrics=${DAY_METRICS}&dimensions=day&sort=day`,
    ),
  ]);
  const stats = channels.items?.[0]?.statistics ?? {};
  const column = (name: string) => report.columnHeaders.findIndex((header) => header.name === name);
  const at = (row: (string | number)[], name: string) => Number(row[column(name)] ?? 0) || 0;
  return {
    subscribers: count(stats.subscriberCount) ?? null,
    totalViews: count(stats.viewCount) ?? null,
    videos: count(stats.videoCount) ?? null,
    days: (report.rows ?? []).map((row) => ({
      date: String(row[column("day")]),
      views: at(row, "views"),
      minutesWatched: at(row, "estimatedMinutesWatched"),
      subscribersGained: at(row, "subscribersGained"),
      subscribersLost: at(row, "subscribersLost"),
      likes: at(row, "likes"),
      comments: at(row, "comments"),
    })),
  };
}
