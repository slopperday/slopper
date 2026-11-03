import { api } from "@convex/_generated/api";
import { TIKTOK_PRIVACY, type TikTokPrivacy } from "~/lib/networks";
import { config } from "../config";
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
 * TikTok's Content Posting API ("Direct Post"). TikTok's rules for apps
 * that post: show whose account it goes to, let the person choose who sees
 * it from the options TikTok gives for that account (never a default), ask
 * about comments, duets and stitches, and disclose branded content. Until
 * TikTok audits the app, every post is private ("Only me").
 *
 * The video is uploaded from this server in chunks (FILE_UPLOAD), so the
 * media's domain needn't be verified with TikTok, then TikTok processes it.
 */

const API = "https://open.tiktokapis.com/v2";

export interface TikTokCredentials {
  kind: "tiktok";
  openId: string;
  accessToken: string;
  refreshToken: string;
  /** Access tokens last a day; refresh tokens a year. */
  expiresAt: string;
}

interface Envelope<T> {
  data: T;
  error?: { code?: string; message?: string };
}

async function tiktok<T>(token: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await okJson<Envelope<T>>(response, "TikTok");
  if (json.error?.code && json.error.code !== "ok") {
    throw new SocialError(`TikTok turned it down: ${json.error.message || json.error.code}`);
  }
  return json.data;
}

/** Trades the refresh token for a new access token when this one is nearly out. */
async function freshToken(account: ConnectedAccount): Promise<TikTokCredentials> {
  const credentials = await openCredentials<TikTokCredentials>(account);
  if (Date.parse(credentials.expiresAt) - Date.now() > 5 * 60_000) return credentials;
  const client = config.tiktok;
  if (!client) throw new SocialError("TikTok isn't set up on this server any more.");
  const response = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    }),
  });
  const tokens = await okJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(
    response,
    "TikTok",
  );
  if (!tokens.access_token) throw new SocialError("TikTok signed this account out. Reconnect it.");
  const next: TikTokCredentials = {
    ...credentials,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? credentials.refreshToken,
    expiresAt: new Date(Date.now() + (tokens.expires_in ?? 86_400) * 1000).toISOString(),
  };
  await convex.mutation(api.accounts.storeCredentials, {
    accountId: account._id,
    sealedCredentials: await sealCredentials(next),
  });
  return next;
}

export interface CreatorInfo {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyOptions: TikTokPrivacy[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxSeconds: number;
}

/** What TikTok lets this account do right now. The composer must show it before posting. */
export async function creatorInfo(account: ConnectedAccount): Promise<CreatorInfo> {
  const { accessToken } = await freshToken(account);
  const data = await tiktok<{
    creator_nickname: string;
    creator_username: string;
    creator_avatar_url?: string;
    privacy_level_options: string[];
    comment_disabled: boolean;
    duet_disabled: boolean;
    stitch_disabled: boolean;
    max_video_post_duration_sec: number;
  }>(accessToken, "post/publish/creator_info/query/", {});
  return {
    nickname: data.creator_nickname,
    username: data.creator_username,
    avatarUrl: data.creator_avatar_url ?? null,
    privacyOptions: data.privacy_level_options.filter((option): option is TikTokPrivacy =>
      (TIKTOK_PRIVACY as readonly string[]).includes(option),
    ),
    commentDisabled: data.comment_disabled,
    duetDisabled: data.duet_disabled,
    stitchDisabled: data.stitch_disabled,
    maxSeconds: data.max_video_post_duration_sec,
  };
}

/** TikTok's chunk rules: one chunk under 5 MB, otherwise equal chunks with the remainder on the last. */
export function chunkPlan(size: number): { chunkSize: number; count: number } {
  const MIN = 5 * 1024 * 1024;
  if (size <= MIN) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * 1024 * 1024;
  return { chunkSize, count: Math.max(1, Math.floor(size / chunkSize)) };
}

export function tiktokAdapter(): SocialAdapter {
  return {
    async publish() {
      throw new SocialError("TikTok needs a video. Post it from the studio.");
    },
    async send(account, draft: Draft): Promise<SendResult> {
      const video = draft.media.find((media) => media.kind === "video");
      if (!video) throw new SocialError("TikTok needs a video.");
      const options = draft.options.tiktok;
      if (!options?.privacy) throw new SocialError("Choose who can see the TikTok.");
      const info = await creatorInfo(account);
      if (!info.privacyOptions.includes(options.privacy)) {
        throw new SocialError("TikTok doesn't allow that audience for this account. Choose another.");
      }
      if (video.duration && video.duration > info.maxSeconds) {
        throw new SocialError(`This TikTok account takes videos up to ${info.maxSeconds} seconds.`);
      }
      const { accessToken } = await freshToken(account);
      const bytes = await loadMedia(video);
      const plan = chunkPlan(bytes.byteLength);
      const init = await tiktok<{ publish_id: string; upload_url: string }>(accessToken, "post/publish/video/init/", {
        post_info: {
          title: draft.text,
          privacy_level: options.privacy,
          disable_comment: !options.allowComments || info.commentDisabled,
          disable_duet: !options.allowDuet || info.duetDisabled,
          disable_stitch: !options.allowStitch || info.stitchDisabled,
          brand_content_toggle: options.brandedContent,
          brand_organic_toggle: options.yourBrand,
          ...(video.coverAt !== undefined ? { video_cover_timestamp_ms: Math.round(video.coverAt * 1000) } : {}),
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: bytes.byteLength,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.count,
        },
      });
      for (let index = 0; index < plan.count; index++) {
        const first = index * plan.chunkSize;
        const last = index === plan.count - 1 ? bytes.byteLength - 1 : first + plan.chunkSize - 1;
        const response = await fetch(init.upload_url, {
          method: "PUT",
          headers: {
            "content-type": video.contentType,
            "content-range": `bytes ${first}-${last}/${bytes.byteLength}`,
          },
          body: bytes.subarray(first, last + 1),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new SocialError("TikTok didn't take the upload. Try again.", response.status);
      }
      return { status: "processing", pending: init.publish_id, retryAfterMs: 15_000 };
    },
    async resume(account, pending) {
      const { accessToken } = await freshToken(account);
      const data = await tiktok<{
        status: string;
        fail_reason?: string;
        publicaly_available_post_id?: (string | number)[];
      }>(accessToken, "post/publish/status/fetch/", { publish_id: pending });
      if (data.status === "FAILED") {
        throw new SocialError(`TikTok couldn't post it${data.fail_reason ? `: ${data.fail_reason}` : "."}`);
      }
      if (data.status !== "PUBLISH_COMPLETE") return { status: "processing", pending, retryAfterMs: 20_000 };
      // Private posts have no public id: the receipt points at the profile.
      const id = data.publicaly_available_post_id?.[0];
      return {
        status: "ok",
        post: {
          provider: "tiktok",
          remoteId: id ? String(id) : pending,
          url: id
            ? `https://www.tiktok.com/@${account.handle}/video/${id}`
            : `https://www.tiktok.com/@${account.handle}`,
        },
      };
    },
    async metrics(account, posts) {
      const { accessToken } = await freshToken(account);
      const found = new Map<string, PostMetrics>();
      const ids = posts.map((post) => post.remoteId).filter((id) => /^\d+$/.test(id));
      for (let i = 0; i < ids.length; i += 20) {
        const data = await tiktok<{ videos?: Record<string, unknown>[] }>(
          accessToken,
          "video/query/?fields=id,view_count,like_count,comment_count,share_count",
          { filters: { video_ids: ids.slice(i, i + 20) } },
        );
        for (const video of data.videos ?? []) {
          found.set(String(video.id), {
            views: count(video.view_count),
            likes: count(video.like_count),
            comments: count(video.comment_count),
            shares: count(video.share_count),
          });
        }
      }
      return found;
    },
  };
}

/** Who a TikTok token belongs to, when connecting. */
export async function fetchTikTokProfile(accessToken: string) {
  const response = await fetch(`${API}/user/info/?fields=open_id,avatar_url,display_name,username`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const { data } = await okJson<
    Envelope<{ user: { open_id: string; avatar_url?: string; display_name?: string; username?: string } }>
  >(response, "TikTok");
  return data.user;
}
