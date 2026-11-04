import { composeFor } from "~/lib/compose";
import { FACEBOOK_GRAPH_VERSION } from "../auth/oauth";
import {
  type ConnectedAccount,
  contentToDraft,
  count,
  type Draft,
  okJson,
  openCredentials,
  type PostMetrics,
  type PublishedPost,
  type SendResult,
  type SocialAdapter,
  SocialError,
  sendAndWait,
} from "./core";

/**
 * Meta's networks. Facebook Pages and Instagram professional accounts come
 * from one Facebook login (each Page and each Instagram account linked to a
 * Page becomes its own connected account), and post through the Graph API
 * with the Page's token. Threads has its own login and API, shaped the
 * same way: make a container, wait for it, publish it.
 *
 * Instagram and Threads fetch pictures and videos from their URLs, so the
 * media has to be on the public web (B2 in production).
 */

const GRAPH = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;
const THREADS = "https://graph.threads.net/v1.0";

export interface PageCredentials {
  kind: "facebook-page";
  pageId: string;
  /** A Page token from a long-lived user token: it doesn't expire. */
  pageToken: string;
}

export interface InstagramCredentials {
  kind: "instagram";
  igUserId: string;
  pageToken: string;
}

export interface ThreadsCredentials {
  kind: "threads";
  userId: string;
  accessToken: string;
  /** Long-lived Threads tokens last 60 days and refresh while still valid. */
  expiresAt: string | null;
}

async function graph<T>(
  base: string,
  token: string,
  path: string,
  params?: Record<string, string>,
  network = "Facebook",
  method?: "DELETE",
): Promise<T> {
  const verb = method ?? (params ? "POST" : "GET");
  const response = await fetch(`${base}/${path}`, {
    method: verb,
    headers: {
      authorization: `Bearer ${token}`,
      ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(params ? { body: new URLSearchParams(params) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  return await okJson<T>(response, network);
}

/** The post's words, already fitted to the network (links included where they work). */
function captionOf(draft: Draft): string {
  return draft.text;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Facebook Pages

export function facebookAdapter(): SocialAdapter {
  async function open(account: ConnectedAccount) {
    return await openCredentials<PageCredentials>(account);
  }

  const postUrl = (id: string) => `https://www.facebook.com/${id}`;

  async function send(account: ConnectedAccount, draft: Draft): Promise<SendResult> {
    const { pageId, pageToken } = await open(account);
    const video = draft.media.find((media) => media.kind === "video");
    const images = draft.media.filter((media) => media.kind === "image");
    if (video) {
      const { id } = await graph<{ id: string }>(GRAPH, pageToken, `${pageId}/videos`, {
        file_url: video.url,
        description: captionOf(draft),
      });
      return { status: "ok", post: { provider: "facebook", remoteId: `video:${id}`, url: postUrl(id) } };
    }
    if (images.length === 1) {
      const photo = await graph<{ id: string; post_id?: string }>(GRAPH, pageToken, `${pageId}/photos`, {
        url: images[0].url,
        message: captionOf(draft),
      });
      const id = photo.post_id ?? photo.id;
      return { status: "ok", post: { provider: "facebook", remoteId: id, url: postUrl(id) } };
    }
    const attached: string[] = [];
    for (const image of images) {
      const { id } = await graph<{ id: string }>(GRAPH, pageToken, `${pageId}/photos`, {
        url: image.url,
        published: "false",
      });
      attached.push(id);
    }
    const { id } = await graph<{ id: string }>(GRAPH, pageToken, `${pageId}/feed`, {
      message: captionOf(draft),
      ...(draft.link && attached.length === 0 ? { link: draft.link } : {}),
      ...(attached.length ? { attached_media: JSON.stringify(attached.map((media_fbid) => ({ media_fbid }))) } : {}),
    });
    return { status: "ok", post: { provider: "facebook", remoteId: id, url: postUrl(id) } };
  }

  return {
    async publish(account, content) {
      const { pageId, pageToken } = await open(account);
      const { id } = await graph<{ id: string }>(GRAPH, pageToken, `${pageId}/feed`, {
        message: content.text,
        link: content.url,
      });
      return { provider: "facebook", remoteId: id, url: postUrl(id) };
    },
    send,
    async reply(account, parent, text) {
      const { pageToken } = await open(account);
      const { id } = await graph<{ id: string }>(
        GRAPH,
        pageToken,
        `${parent.remoteId.replace(/^video:/, "")}/comments`,
        {
          message: text,
        },
      );
      return { remoteId: id };
    },
    async remove(account, remoteId) {
      const { pageToken } = await open(account);
      await graph(GRAPH, pageToken, remoteId.replace(/^video:/, ""), undefined, "Facebook", "DELETE");
    },
    async comments(account, post) {
      const { pageToken } = await open(account);
      const { data } = await graph<{
        data: { id: string; message?: string; from?: { name?: string }; created_time?: string }[];
      }>(
        GRAPH,
        pageToken,
        `${post.remoteId.replace(/^video:/, "")}/comments?limit=25&fields=id,message,from{name},created_time`,
      );
      return data.map((item) => ({
        id: item.id,
        author: item.from?.name ?? "someone",
        text: item.message ?? "",
        at: item.created_time ?? null,
      }));
    },
    async metrics(account, posts) {
      const { pageToken } = await open(account);
      const found = new Map<string, PostMetrics>();
      for (const post of posts) {
        const isVideo = post.remoteId.startsWith("video:");
        const id = post.remoteId.replace(/^video:/, "");
        const fields = isVideo
          ? "likes.summary(total_count).limit(0),comments.summary(total_count).limit(0)"
          : "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares";
        try {
          const data = await graph<{
            reactions?: { summary?: { total_count?: number } };
            likes?: { summary?: { total_count?: number } };
            comments?: { summary?: { total_count?: number } };
            shares?: { count?: number };
          }>(GRAPH, pageToken, `${id}?fields=${encodeURIComponent(fields)}`);
          found.set(post.remoteId, {
            likes: count((data.reactions ?? data.likes)?.summary?.total_count),
            comments: count(data.comments?.summary?.total_count),
            shares: count(data.shares?.count) ?? (isVideo ? undefined : 0),
          });
        } catch (error) {
          console.warn("Reading a Facebook post's stats failed", error);
        }
      }
      return found;
    },
  };
}

// ---------------------------------------------------------------------------
// Instagram

/** What the composer tells Instagram a container is. */
function instagramParams(draft: Draft, mediaIndex?: number): Record<string, string> {
  const story = draft.options.instagram?.format === "story";
  const media = mediaIndex === undefined ? draft.media[0] : draft.media[mediaIndex];
  if (!media) throw new SocialError("Instagram needs a picture or a video.");
  const source: Record<string, string> =
    media.kind === "video"
      ? {
          video_url: media.url,
          ...(media.coverAt !== undefined ? { thumb_offset: String(Math.round(media.coverAt * 1000)) } : {}),
        }
      : { image_url: media.url, ...(media.alt?.trim() ? { alt_text: media.alt.trim().slice(0, 1000) } : {}) };
  if (story) return { media_type: "STORIES", ...source };
  if (mediaIndex !== undefined) {
    return { is_carousel_item: "true", ...source, ...(media.kind === "video" ? { media_type: "VIDEO" } : {}) };
  }
  const collaborators = draft.options.instagram?.collaborators ?? [];
  const shared = {
    caption: captionOf(draft),
    ...(collaborators.length ? { collaborators: JSON.stringify(collaborators.slice(0, 3)) } : {}),
  };
  return media.kind === "video"
    ? { media_type: "REELS", share_to_feed: "true", ...shared, ...source }
    : { ...shared, ...source };
}

export function instagramAdapter(): SocialAdapter {
  async function open(account: ConnectedAccount) {
    return await openCredentials<InstagramCredentials>(account);
  }

  /** Publishes a finished container, or says to come back while it processes. */
  async function advance(account: ConnectedAccount, container: string): Promise<SendResult> {
    const { igUserId, pageToken } = await open(account);
    for (let tries = 0; tries < 4; tries++) {
      const { status_code: status } = await graph<{ status_code?: string }>(
        GRAPH,
        pageToken,
        `${container}?fields=status_code`,
        undefined,
        "Instagram",
      );
      if (status === "ERROR" || status === "EXPIRED") {
        throw new SocialError(
          "Instagram couldn't use that upload. Pictures must be JPEGs, and Reels 3 seconds to 15 minutes long.",
        );
      }
      if (status === "FINISHED" || status === "PUBLISHED") {
        const { id } = await graph<{ id: string }>(
          GRAPH,
          pageToken,
          `${igUserId}/media_publish`,
          { creation_id: container },
          "Instagram",
        );
        const { permalink } = await graph<{ permalink?: string }>(
          GRAPH,
          pageToken,
          `${id}?fields=permalink`,
          undefined,
          "Instagram",
        ).catch(() => ({ permalink: undefined }));
        return {
          status: "ok",
          post: {
            provider: "instagram",
            remoteId: id,
            url: permalink ?? `https://www.instagram.com/${account.handle}/`,
          },
        };
      }
      await wait(2_000);
    }
    return { status: "processing", pending: container, retryAfterMs: 20_000 };
  }

  async function send(account: ConnectedAccount, draft: Draft): Promise<SendResult> {
    const { igUserId, pageToken } = await open(account);
    if (draft.media.length === 0) throw new SocialError("Instagram needs a picture or a video.");
    const create = (params: Record<string, string>) =>
      graph<{ id: string }>(GRAPH, pageToken, `${igUserId}/media`, params, "Instagram");
    let container: string;
    if (draft.media.length > 1 && draft.options.instagram?.format !== "story") {
      const children: string[] = [];
      for (let index = 0; index < draft.media.length; index++) {
        children.push((await create(instagramParams(draft, index))).id);
      }
      container = (await create({ media_type: "CAROUSEL", children: children.join(","), caption: captionOf(draft) }))
        .id;
    } else {
      container = (await create(instagramParams(draft))).id;
    }
    return await advance(account, container);
  }

  return {
    async reply(account, parent, text) {
      const { pageToken } = await open(account);
      const path = parent.kind === "comment" ? `${parent.remoteId}/replies` : `${parent.remoteId}/comments`;
      const { id } = await graph<{ id: string }>(GRAPH, pageToken, path, { message: text }, "Instagram");
      return { remoteId: id };
    },
    async comments(account, post) {
      const { pageToken } = await open(account);
      const { data } = await graph<{ data: { id: string; text?: string; username?: string; timestamp?: string }[] }>(
        GRAPH,
        pageToken,
        `${post.remoteId}/comments?limit=25&fields=id,text,username,timestamp`,
        undefined,
        "Instagram",
      );
      return data.map((item) => ({
        id: item.id,
        author: item.username ?? "someone",
        text: item.text ?? "",
        at: item.timestamp ?? null,
      }));
    },
    async publish(account, content) {
      if (!content.imageUrl) throw new SocialError("Instagram needs a picture, and this has no screenshot.");
      return await sendAndWait(this, account, contentToDraft(composeFor("instagram", content), content));
    },
    send,
    async resume(account, pending) {
      return await advance(account, pending);
    },
    async metrics(account, posts) {
      const { pageToken } = await open(account);
      const found = new Map<string, PostMetrics>();
      for (const post of posts) {
        try {
          const { data } = await graph<{ data: InsightValue[] }>(
            GRAPH,
            pageToken,
            `${post.remoteId}/insights?metric=views,likes,comments,shares,saved`,
            undefined,
            "Instagram",
          );
          const value = insightReader(data);
          found.set(post.remoteId, {
            views: value("views"),
            likes: value("likes"),
            comments: value("comments"),
            shares: value("shares"),
            saves: value("saved"),
          });
        } catch (error) {
          console.warn("Reading an Instagram post's stats failed", error);
        }
      }
      return found;
    },
  };
}

interface InsightValue {
  name: string;
  values?: { value?: number }[];
  total_value?: { value?: number };
}

function insightReader(data: readonly InsightValue[]) {
  return (name: string) => {
    const metric = data.find((item) => item.name === name);
    return count(metric?.total_value?.value ?? metric?.values?.[0]?.value);
  };
}

// ---------------------------------------------------------------------------
// Threads

/** Refreshes a long-lived Threads token in its last week; it lasts another 60 days. */
export async function freshThreadsToken(
  account: ConnectedAccount,
  store: (credentials: ThreadsCredentials) => Promise<void>,
): Promise<ThreadsCredentials> {
  const credentials = await openCredentials<ThreadsCredentials>(account);
  const expiresAt = credentials.expiresAt ? Date.parse(credentials.expiresAt) : Infinity;
  if (expiresAt < Date.now()) throw new SocialError("Threads connections last 60 days. Reconnect the account.");
  if (expiresAt - Date.now() > 7 * 86_400_000) return credentials;
  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", credentials.accessToken);
  const response = await fetch(url);
  const fresh = await okJson<{ access_token: string; expires_in: number }>(response, "Threads");
  const next: ThreadsCredentials = {
    ...credentials,
    accessToken: fresh.access_token,
    expiresAt: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
  };
  await store(next);
  return next;
}

export function threadsAdapter(
  store: (account: ConnectedAccount, credentials: ThreadsCredentials) => Promise<void> = async () => {},
): SocialAdapter {
  const open = (account: ConnectedAccount) => freshThreadsToken(account, (next) => store(account, next));
  const call = <T>(token: string, path: string, params?: Record<string, string>) =>
    graph<T>(THREADS, token, path, params, "Threads");

  async function advance(account: ConnectedAccount, container: string): Promise<SendResult> {
    const { userId, accessToken } = await open(account);
    for (let tries = 0; tries < 4; tries++) {
      const { status, error_message: reason } = await call<{ status?: string; error_message?: string }>(
        accessToken,
        `${container}?fields=status,error_message`,
      );
      if (status === "ERROR" || status === "EXPIRED") {
        throw new SocialError(`Threads couldn't use that upload${reason ? `: ${reason}` : "."}`);
      }
      if (status === "FINISHED" || status === "PUBLISHED") {
        const { id } = await call<{ id: string }>(accessToken, `${userId}/threads_publish`, { creation_id: container });
        const { permalink } = await call<{ permalink?: string }>(accessToken, `${id}?fields=permalink`).catch(() => ({
          permalink: undefined,
        }));
        return {
          status: "ok",
          post: { provider: "threads", remoteId: id, url: permalink ?? `https://www.threads.net/@${account.handle}` },
        };
      }
      await wait(2_000);
    }
    return { status: "processing", pending: container, retryAfterMs: 20_000 };
  }

  async function send(account: ConnectedAccount, draft: Draft): Promise<SendResult> {
    const { userId, accessToken } = await open(account);
    const create = (params: Record<string, string>) => call<{ id: string }>(accessToken, `${userId}/threads`, params);
    const source = (index: number): Record<string, string> => {
      const media = draft.media[index];
      const alt: Record<string, string> = media.alt?.trim() ? { alt_text: media.alt.trim().slice(0, 1000) } : {};
      return media.kind === "video"
        ? { media_type: "VIDEO", video_url: media.url, ...alt }
        : { media_type: "IMAGE", image_url: media.url, ...alt };
    };
    let container: string;
    if (draft.media.length > 1) {
      const children: string[] = [];
      for (let index = 0; index < draft.media.length; index++) {
        children.push((await create({ ...source(index), is_carousel_item: "true" })).id);
      }
      container = (await create({ media_type: "CAROUSEL", children: children.join(","), text: draft.text })).id;
    } else if (draft.media.length === 1) {
      container = (await create({ ...source(0), text: draft.text })).id;
    } else {
      container = (
        await create({ media_type: "TEXT", text: draft.text, ...(draft.link ? { link_attachment: draft.link } : {}) })
      ).id;
    }
    return await advance(account, container);
  }

  return {
    async publish(account, content): Promise<PublishedPost> {
      return await sendAndWait(this, account, {
        text: composeFor("threads", content),
        link: content.url,
        media: [],
        options: {},
      });
    },
    send,
    async resume(account, pending) {
      return await advance(account, pending);
    },
    async amplify(account, post) {
      const { accessToken } = await open(account);
      await call(accessToken, `${post.remoteId}/repost`, {});
    },
    async reply(account, parent, text) {
      const { userId, accessToken } = await open(account);
      const { id } = await call<{ id: string }>(accessToken, `${userId}/threads`, {
        media_type: "TEXT",
        text,
        reply_to_id: parent.remoteId,
      });
      const result = await advance(account, id);
      if (result.status !== "ok") throw new SocialError("Threads is still processing the reply.");
      return { remoteId: result.post.remoteId };
    },
    async remove(account, remoteId) {
      const { accessToken } = await open(account);
      await graph(THREADS, accessToken, remoteId, undefined, "Threads", "DELETE");
    },
    async comments(account, post) {
      const { accessToken } = await open(account);
      const { data } = await call<{ data: { id: string; text?: string; username?: string; timestamp?: string }[] }>(
        accessToken,
        `${post.remoteId}/replies?fields=id,text,username,timestamp`,
      );
      return data.map((item) => ({
        id: item.id,
        author: item.username ?? "someone",
        text: item.text ?? "",
        at: item.timestamp ?? null,
      }));
    },
    async metrics(account, posts) {
      const { accessToken } = await open(account);
      const found = new Map<string, PostMetrics>();
      for (const post of posts) {
        try {
          const { data } = await call<{ data: InsightValue[] }>(
            accessToken,
            `${post.remoteId}/insights?metric=views,likes,replies,reposts,quotes,shares`,
          );
          const value = insightReader(data);
          found.set(post.remoteId, {
            views: value("views"),
            likes: value("likes"),
            comments: value("replies"),
            reposts: (value("reposts") ?? 0) + (value("quotes") ?? 0),
            shares: value("shares"),
          });
        } catch (error) {
          console.warn("Reading a Threads post's stats failed", error);
        }
      }
      return found;
    },
  };
}

// ---------------------------------------------------------------------------
// Connecting

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  picture: string | null;
  instagram: { id: string; username: string; name: string; picture: string | null } | null;
}

/**
 * The Pages a Facebook login granted, each with its Instagram professional
 * account when one is linked. Facebook's own dialog lets the person choose
 * which Pages to grant, so every Page here was picked by them.
 */
export async function fetchMetaPages(userToken: string, appId: string, appSecret: string): Promise<MetaPage[]> {
  // Exchange for a long-lived user token, so the Page tokens derived from it never expire.
  const exchange = await fetch(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: userToken,
    }),
  });
  const { access_token: longLived } = await okJson<{ access_token: string }>(exchange, "Facebook");
  return await fetchMetaPagesFromToken(longLived);
}

/** Reads Pages and linked Instagram professional accounts from a long-lived user or Page token. */
export async function fetchMetaPagesFromToken(token: string): Promise<MetaPage[]> {
  const fields = "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}";
  const { data } = await graph<{
    data?: {
      id: string;
      name: string;
      access_token?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: { id: string; username: string; name?: string; profile_picture_url?: string };
    }[];
  }>(GRAPH, token, `me/accounts?limit=100&fields=${encodeURIComponent(fields)}`).catch(() => ({ data: undefined }));
  if (data && data.length > 0) {
    return data.map((page) => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token ?? token,
      picture: page.picture?.data?.url ?? null,
      instagram: page.instagram_business_account
        ? {
            id: page.instagram_business_account.id,
            username: page.instagram_business_account.username,
            name: page.instagram_business_account.name ?? page.instagram_business_account.username,
            picture: page.instagram_business_account.profile_picture_url ?? null,
          }
        : null,
    }));
  }
  const single = await graph<{
    id: string;
    name: string;
    picture?: { data?: { url?: string } };
    instagram_business_account?: { id: string; username: string; name?: string; profile_picture_url?: string };
  }>(
    GRAPH,
    token,
    `me?fields=${encodeURIComponent("id,name,picture{url},instagram_business_account{id,username,name,profile_picture_url}")}`,
  );
  return [
    {
      id: single.id,
      name: single.name,
      accessToken: token,
      picture: single.picture?.data?.url ?? null,
      instagram: single.instagram_business_account
        ? {
            id: single.instagram_business_account.id,
            username: single.instagram_business_account.username,
            name: single.instagram_business_account.name ?? single.instagram_business_account.username,
            picture: single.instagram_business_account.profile_picture_url ?? null,
          }
        : null,
    },
  ];
}

/** Swaps a Threads code's short-lived token for a 60-day one, and says whose it is. */
export async function fetchThreadsProfile(shortToken: string, appSecret: string) {
  const url = new URL("https://graph.threads.net/access_token");
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortToken);
  const exchange = await fetch(url);
  const long = await okJson<{ access_token: string; expires_in: number }>(exchange, "Threads");
  return await fetchThreadsFromToken(long.access_token, new Date(Date.now() + long.expires_in * 1000).toISOString());
}

/** Verifies a Threads user token and packs its credentials. */
export async function fetchThreadsFromToken(accessToken: string, expiresAt: string | null = null) {
  const profile = await graph<{ id: string; username: string; name?: string; threads_profile_picture_url?: string }>(
    THREADS,
    accessToken,
    "me?fields=id,username,name,threads_profile_picture_url",
    undefined,
    "Threads",
  );
  return {
    profile,
    credentials: {
      kind: "threads",
      userId: profile.id,
      accessToken,
      expiresAt,
    } satisfies ThreadsCredentials,
  };
}
