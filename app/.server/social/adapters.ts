import { lookup } from "node:dns/promises";
import { api } from "@convex/_generated/api";
import type { SocialProvider } from "~/lib/model";
import { convex } from "../convex";
import { clientCredentials, refreshTokens } from "../auth/oauth";
import { assertFetchable, isPublicAddress, publicFetch } from "../preview";
import { composeFor } from "~/lib/compose";
import {
  type ConnectedAccount,
  count,
  type DraftMedia,
  expectOk,
  loadImage,
  loadMedia,
  okJson,
  openCredentials,
  type PostMetrics,
  type SocialAdapter,
  SocialError,
  sealCredentials,
  type SendResult,
} from "./core";
import { facebookAdapter, instagramAdapter, threadsAdapter } from "./meta";
import { tiktokAdapter } from "./tiktok";
import { youtubeAdapter } from "./youtube";
import { xAuthorization, type XOwnCredentials } from "./x-credentials";

export {
  type ConnectedAccount,
  type LaunchAdapter,
  type PublishedPost,
  type SocialAdapter,
  SocialError,
  sealCredentials,
} from "./core";

/**
 * Network adapters. Each one turns `PostContent` (a launch or update) into a
 * real post, a studio `Draft` into one with its pictures or video, reads
 * sent posts' stats where the network shares them, and, where the network
 * supports it, reposts another account's post ("amplify").
 */

export interface XCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

export interface LinkedInCredentials {
  accessToken: string;
  expiresAt: string | null;
  personUrn: string;
}

export interface BlueskyCredentials {
  service: string;
  identifier: string;
  appPassword: string;
}

// ---------------------------------------------------------------------------
// X

const X_API = "https://api.x.com/2";
/** X takes upload chunks up to 5 MB. */
const X_CHUNK = 4 * 1024 * 1024;

interface XMediaState {
  processing_info?: {
    state: "pending" | "in_progress" | "succeeded" | "failed";
    check_after_secs?: number;
    error?: { message?: string };
  };
}

/** How long to wait before asking about an upload again, or null when it's ready. Throws when it failed. */
function processingWait(state: XMediaState): number | null {
  const info = state.processing_info;
  if (!info || info.state === "succeeded") return null;
  if (info.state === "failed")
    throw new SocialError(`X couldn't process the video${info.error?.message ? `: ${info.error.message}` : "."}`);
  return (info.check_after_secs ?? 5) * 1000;
}

export function xAdapter(): SocialAdapter {
  async function accessToken(account: ConnectedAccount): Promise<string> {
    const credentials = await openCredentials<XCredentials>(account);
    const expiresAt = credentials.expiresAt ? Date.parse(credentials.expiresAt) : Infinity;
    if (expiresAt - Date.now() > 120_000) return credentials.accessToken;

    const client = clientCredentials("x");
    if (!client || !credentials.refreshToken) {
      throw new SocialError("X session expired. Reconnect the account.");
    }
    const tokens = await refreshTokens("x", client, credentials.refreshToken);
    // X rotates refresh tokens: persist before anything else can fail.
    const next: XCredentials = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? credentials.refreshToken,
      expiresAt: tokens.expiresAt,
    };
    await convex.mutation(api.accounts.storeCredentials, {
      accountId: account._id,
      sealedCredentials: await sealCredentials(next),
    });
    return next.accessToken;
  }

  async function authorization(account: ConnectedAccount, method: string, url: string): Promise<string> {
    const credentials = await openCredentials<XCredentials | XOwnCredentials>(account);
    if ("kind" in credentials && credentials.kind === "own-app") return xAuthorization(credentials, method, url);
    return `Bearer ${await accessToken(account)}`;
  }

  async function call(account: ConnectedAccount, method: string, url: string, init: RequestInit = {}) {
    return await fetch(url, {
      ...init,
      method,
      headers: {
        ...(init.headers as Record<string, string>),
        authorization: await authorization(account, method, url),
      },
    });
  }

  async function tweet(account: ConnectedAccount, text: string, mediaIds: readonly string[] = [], replyTo?: string) {
    const response = await call(account, "POST", `${X_API}/tweets`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
        ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
      }),
    });
    const { data } = await okJson<{ data: { id: string } }>(response, "X");
    return {
      provider: "x" as const,
      remoteId: data.id,
      url: `https://x.com/${account.handle}/status/${data.id}`,
    };
  }

  /** X's chunked upload, for pictures and videos alike; videos then process. */
  async function upload(account: ConnectedAccount, media: DraftMedia): Promise<{ id: string; waitMs: number | null }> {
    const bytes = await loadMedia(media);
    const category =
      media.kind === "video" ? "tweet_video" : media.contentType === "image/gif" ? "tweet_gif" : "tweet_image";
    const init = await call(account, "POST", `${X_API}/media/upload/initialize`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ media_type: media.contentType, total_bytes: bytes.byteLength, media_category: category }),
    });
    const { data } = await okJson<{ data: { id: string } }>(init, "X");
    for (let index = 0, offset = 0; offset < bytes.byteLength; index++, offset += X_CHUNK) {
      const form = new FormData();
      form.set("segment_index", String(index));
      form.set("media", new Blob([bytes.subarray(offset, offset + X_CHUNK)], { type: media.contentType }));
      await expectOk(await call(account, "POST", `${X_API}/media/upload/${data.id}/append`, { body: form }), "X");
    }
    const finalized = await okJson<{ data: XMediaState }>(
      await call(account, "POST", `${X_API}/media/upload/${data.id}/finalize`),
      "X",
    );
    if (media.alt?.trim() && media.kind === "image") {
      const alt = await call(account, "POST", `${X_API}/media/metadata`, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: data.id, metadata: { alt_text: { text: media.alt.trim().slice(0, 1000) } } }),
      });
      // Alt text is a courtesy: a refusal never stops the post.
      if (!alt.ok) console.warn(`X refused alt text (${alt.status})`);
    }
    return { id: data.id, waitMs: processingWait(finalized.data) };
  }

  async function finish(account: ConnectedAccount, text: string, ids: readonly string[]): Promise<SendResult> {
    let wait: number | null = null;
    for (const id of ids) {
      const status = await okJson<{ data: XMediaState }>(
        await call(account, "GET", `${X_API}/media/upload?command=STATUS&media_id=${id}`),
        "X",
      );
      const next = processingWait(status.data);
      if (next !== null) wait = Math.max(wait ?? 0, next);
    }
    if (wait !== null) return { status: "processing", pending: JSON.stringify({ ids }), retryAfterMs: wait };
    return { status: "ok", post: await tweet(account, text, ids) };
  }

  return {
    async publish(account, content) {
      return await tweet(account, composeFor("x", content));
    },
    async send(account, draft) {
      const uploads = [];
      for (const media of draft.media) uploads.push(await upload(account, media));
      if (uploads.some((item) => item.waitMs !== null)) {
        const wait = Math.max(...uploads.map((item) => item.waitMs ?? 0));
        return { status: "processing", pending: JSON.stringify({ ids: uploads.map((u) => u.id) }), retryAfterMs: wait };
      }
      return {
        status: "ok",
        post: await tweet(
          account,
          draft.text,
          uploads.map((item) => item.id),
        ),
      };
    },
    async resume(account, pending, draft) {
      const { ids } = JSON.parse(pending) as { ids: string[] };
      return await finish(account, draft.text, ids);
    },
    async reply(account, parent, text) {
      const post = await tweet(account, text, [], parent.remoteId);
      return { remoteId: post.remoteId };
    },
    async remove(account, remoteId) {
      await expectOk(await call(account, "DELETE", `${X_API}/tweets/${remoteId}`), "X");
    },
    async metrics(account, posts) {
      const found = new Map<string, PostMetrics>();
      for (let i = 0; i < posts.length; i += 100) {
        const ids = posts.slice(i, i + 100).map((post) => post.remoteId);
        const url = `${X_API}/tweets?ids=${ids.join(",")}&tweet.fields=public_metrics`;
        const { data } = await okJson<{ data?: { id: string; public_metrics?: Record<string, number> }[] }>(
          await call(account, "GET", url),
          "X",
        );
        for (const item of data ?? []) {
          const m = item.public_metrics ?? {};
          found.set(item.id, {
            views: count(m.impression_count),
            likes: count(m.like_count),
            comments: count(m.reply_count),
            reposts: (count(m.retweet_count) ?? 0) + (count(m.quote_count) ?? 0),
            saves: count(m.bookmark_count),
          });
        }
      }
      return found;
    },
    async amplify(account, post) {
      const response = await fetch(`${X_API}/users/${account.remoteId}/retweets`, {
        method: "POST",
        headers: {
          authorization: await authorization(account, "POST", `${X_API}/users/${account.remoteId}/retweets`),
          "content-type": "application/json",
        },
        body: JSON.stringify({ tweet_id: post.remoteId }),
      });
      await expectOk(response, "X");
    },
  };
}

export async function fetchXProfile(credentials: string | XOwnCredentials) {
  const url = `${X_API}/users/me?user.fields=profile_image_url`;
  const response = await fetch(url, {
    headers: {
      authorization:
        typeof credentials === "string" ? `Bearer ${credentials}` : xAuthorization(credentials, "GET", url),
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  // Credential verification errors must never echo provider bodies or submitted secrets.
  if (typeof credentials === "string") await expectOk(response, "X");
  else if (!response.ok)
    throw new SocialError(
      "X couldn't verify these credentials. Check all four values, app permissions and API credits.",
    );
  const { data } = (await response.json()) as {
    data: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    };
  };
  if (!data || !/^\d+$/.test(data.id) || !/^[A-Za-z0-9_]{1,15}$/.test(data.username)) {
    throw new SocialError("X didn't return an account. Check your user access token.");
  }
  return data;
}

// ---------------------------------------------------------------------------
// LinkedIn

const LINKEDIN_API = "https://api.linkedin.com/rest";
/** LinkedIn versions its API monthly and retires versions after a year. */
export const LINKEDIN_VERSION = "202609";

/** Commentary uses "little text": these characters must be escaped. */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (char) => `\\${char}`);
}

export function linkedinAdapter(): SocialAdapter {
  function headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "linkedin-version": LINKEDIN_VERSION,
      "x-restli-protocol-version": "2.0.0",
    };
  }

  async function open(account: ConnectedAccount) {
    const credentials = await openCredentials<LinkedInCredentials>(account);
    if (credentials.expiresAt && Date.parse(credentials.expiresAt) < Date.now()) {
      throw new SocialError("LinkedIn connections last 60 days. Reconnect the account.");
    }
    return credentials;
  }

  async function uploadImageBytes(token: string, owner: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const init = await fetch(`${LINKEDIN_API}/images?action=initializeUpload`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    });
    const { value } = await okJson<{ value: { uploadUrl: string; image: string } }>(init, "LinkedIn");
    const upload = await fetch(value.uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: bytes,
    });
    await expectOk(upload, "LinkedIn");
    return value.image;
  }

  async function uploadThumbnail(token: string, owner: string, imageUrl: string | null): Promise<string | null> {
    const image = await loadImage(imageUrl, 5 * 1024 * 1024);
    return image ? await uploadImageBytes(token, owner, image.bytes) : null;
  }

  /** LinkedIn's multi-part video upload: it says where each slice goes, and wants each slice's ETag back. */
  async function uploadVideo(token: string, owner: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const init = await fetch(`${LINKEDIN_API}/videos?action=initializeUpload`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        initializeUploadRequest: {
          owner,
          fileSizeBytes: bytes.byteLength,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
    });
    const { value } = await okJson<{
      value: {
        video: string;
        uploadToken?: string;
        uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[];
      };
    }>(init, "LinkedIn");
    const etags: string[] = [];
    for (const part of value.uploadInstructions) {
      const response = await fetch(part.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: bytes.subarray(part.firstByte, part.lastByte + 1),
      });
      await expectOk(response, "LinkedIn");
      etags.push(response.headers.get("etag") ?? "");
    }
    const finalize = await fetch(`${LINKEDIN_API}/videos?action=finalizeUpload`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? "", uploadedPartIds: etags },
      }),
    });
    await expectOk(finalize, "LinkedIn");
    return value.video;
  }

  /** LinkedIn's document upload: a PDF it shows as a swipeable carousel. */
  async function uploadDocument(token: string, owner: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const init = await fetch(`${LINKEDIN_API}/documents?action=initializeUpload`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    });
    const { value } = await okJson<{ value: { uploadUrl: string; document: string } }>(init, "LinkedIn");
    const upload = await fetch(value.uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: bytes,
    });
    await expectOk(upload, "LinkedIn");
    return value.document;
  }

  async function createPost(token: string, author: string, commentary: string, content?: unknown) {
    const response = await fetch(`${LINKEDIN_API}/posts`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        author,
        commentary: escapeLittleText(commentary),
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        ...(content ? { content } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    await expectOk(response, "LinkedIn");
    const urn = response.headers.get("x-restli-id") ?? "";
    return {
      provider: "linkedin" as const,
      remoteId: urn,
      url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : "https://www.linkedin.com/feed/",
    };
  }

  return {
    async publish(account, content) {
      const credentials = await open(account);
      const token = credentials.accessToken;
      const thumbnail = await uploadThumbnail(token, credentials.personUrn, content.imageUrl).catch(() => null);
      return await createPost(token, credentials.personUrn, composeFor("linkedin", content), {
        article: {
          source: content.url,
          title: content.title,
          description: content.description,
          ...(thumbnail ? { thumbnail } : {}),
        },
      });
    },
    async send(account, draft) {
      const { accessToken: token, personUrn: owner } = await open(account);
      const video = draft.media.find((media) => media.kind === "video");
      const document = draft.media.find((media) => media.kind === "document");
      const images = draft.media.filter((media) => media.kind === "image");
      let content: unknown;
      if (document) {
        const title = draft.options.linkedin?.documentTitle.trim() || "Document";
        content = { media: { id: await uploadDocument(token, owner, await loadMedia(document)), title } };
      } else if (video) {
        content = { media: { id: await uploadVideo(token, owner, await loadMedia(video)) } };
      } else if (images.length > 0) {
        const items = [];
        for (const image of images) {
          const id = await uploadImageBytes(token, owner, await loadMedia(image));
          items.push({ id, ...(image.alt?.trim() ? { altText: image.alt.trim().slice(0, 4086) } : {}) });
        }
        content = items.length === 1 ? { media: items[0] } : { multiImage: { images: items } };
      }
      // Without media, a link in the words unfurls into a card by itself.
      return { status: "ok", post: await createPost(token, owner, draft.text, content) };
    },
    async reply(account, parent, text) {
      const { accessToken: token, personUrn: actor } = await open(account);
      const response = await fetch(`${LINKEDIN_API}/socialActions/${encodeURIComponent(parent.remoteId)}/comments`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ actor, object: parent.remoteId, message: { text } }),
      });
      await expectOk(response, "LinkedIn");
      return { remoteId: response.headers.get("x-restli-id") ?? "" };
    },
    async remove(account, remoteId) {
      const { accessToken: token } = await open(account);
      const response = await fetch(`${LINKEDIN_API}/posts/${encodeURIComponent(remoteId)}`, {
        method: "DELETE",
        headers: headers(token),
      });
      if (response.status !== 404) await expectOk(response, "LinkedIn");
    },
  };
}

export async function fetchLinkedInProfile(accessToken: string) {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  await expectOk(response, "LinkedIn");
  return (await response.json()) as {
    sub: string;
    name?: string;
    given_name?: string;
    picture?: string;
  };
}

// ---------------------------------------------------------------------------
// Bluesky

interface BlueskySession {
  accessJwt: string;
  did: string;
  handle: string;
}

/**
 * A Bluesky PDS this server may talk to. The address comes from whoever
 * connects the account, so a private one would aim the server's requests at
 * internal networks (SSRF) — now, and again on every auto-post, since the
 * address is kept with the account. The rules are the link previews'
 * (./preview.ts): a public web address on the standard ports, no credentials,
 * and the name has to resolve publicly too.
 */
export async function assertPublicService(service: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(service);
  } catch {
    throw new SocialError("That PDS address isn't a URL.");
  }
  try {
    assertFetchable(url);
  } catch {
    throw new SocialError("A PDS lives on the public web, on the standard ports.");
  }
  const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new SocialError("A PDS has to be on the public internet.");
  }
}

export async function createBlueskySession(credentials: BlueskyCredentials): Promise<BlueskySession> {
  await assertPublicService(credentials.service);
  // The pinned transport (`publicFetch`): the address can't rebind to a
  // private one between the check above and the connection.
  const response = await publicFetch(new URL(`${credentials.service}/xrpc/com.atproto.server.createSession`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: credentials.identifier,
      password: credentials.appPassword,
    }),
    timeoutMs: 15_000,
  });
  await expectOk(response, "Bluesky");
  return (await response.json()) as BlueskySession;
}

/** Link facets so URLs in the text are clickable (byte offsets, UTF-8). */
export function linkFacets(text: string) {
  const encoder = new TextEncoder();
  const facets = [];
  for (const match of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const byteStart = encoder.encode(text.slice(0, match.index)).byteLength;
    const byteEnd = byteStart + encoder.encode(match[0]).byteLength;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }],
    });
  }
  return facets;
}

/** Bluesky's blob limit for pictures. */
const BLUESKY_IMAGE_BYTES = 1_000_000;

export function blueskyAdapter(): SocialAdapter {
  async function session(account: ConnectedAccount) {
    const credentials = await openCredentials<BlueskyCredentials>(account);
    return { credentials, session: await createBlueskySession(credentials) };
  }

  async function createRecord(
    service: string,
    auth: BlueskySession,
    collection: string,
    record: Record<string, unknown>,
  ): Promise<{ uri: string; cid: string }> {
    const response = await publicFetch(new URL(`${service}/xrpc/com.atproto.repo.createRecord`), {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.accessJwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ repo: auth.did, collection, record }),
      timeoutMs: 15_000,
    });
    await expectOk(response, "Bluesky");
    return (await response.json()) as { uri: string; cid: string };
  }

  return {
    async publish(account, content) {
      const { credentials, session: auth } = await session(account);
      const text = composeFor("bluesky", content);
      const image = await loadImage(content.imageUrl, 950_000);
      let thumb: unknown = undefined;
      if (image) {
        const upload = await publicFetch(new URL(`${credentials.service}/xrpc/com.atproto.repo.uploadBlob`), {
          method: "POST",
          headers: {
            authorization: `Bearer ${auth.accessJwt}`,
            "content-type": image.contentType,
          },
          body: image.bytes,
          timeoutMs: 15_000,
        });
        if (upload.ok) thumb = ((await upload.json()) as { blob: unknown }).blob;
      }
      const created = await createRecord(credentials.service, auth, "app.bsky.feed.post", {
        $type: "app.bsky.feed.post",
        text,
        facets: linkFacets(text),
        createdAt: new Date().toISOString(),
        embed: {
          $type: "app.bsky.embed.external",
          external: {
            uri: content.url,
            title: content.title,
            description: content.description,
            ...(thumb ? { thumb } : {}),
          },
        },
      });
      const rkey = created.uri.split("/").pop();
      return {
        provider: "bluesky",
        remoteId: created.uri,
        cid: created.cid,
        url: `https://bsky.app/profile/${auth.handle}/post/${rkey}`,
      };
    },
    async send(account, draft) {
      const { credentials, session: auth } = await session(account);
      const images = [];
      for (const media of draft.media) {
        if (media.kind !== "image") throw new SocialError("Bluesky can't take videos from apps yet.");
        const bytes = await loadMedia(media);
        if (bytes.byteLength > BLUESKY_IMAGE_BYTES) throw new SocialError("Bluesky takes pictures up to 1 MB.");
        const upload = await publicFetch(new URL(`${credentials.service}/xrpc/com.atproto.repo.uploadBlob`), {
          method: "POST",
          headers: { authorization: `Bearer ${auth.accessJwt}`, "content-type": media.contentType },
          body: bytes,
          timeoutMs: 30_000,
        });
        const { blob } = await okJson<{ blob: unknown }>(upload, "Bluesky");
        images.push({ image: blob, alt: media.alt?.trim().slice(0, 2000) ?? "" });
      }
      const created = await createRecord(credentials.service, auth, "app.bsky.feed.post", {
        $type: "app.bsky.feed.post",
        text: draft.text,
        facets: linkFacets(draft.text),
        createdAt: new Date().toISOString(),
        ...(images.length
          ? { embed: { $type: "app.bsky.embed.images", images } }
          : draft.link
            ? {
                embed: {
                  $type: "app.bsky.embed.external",
                  external: { uri: draft.link, title: draft.link, description: "" },
                },
              }
            : {}),
      });
      const rkey = created.uri.split("/").pop();
      return {
        status: "ok",
        post: {
          provider: "bluesky",
          remoteId: created.uri,
          cid: created.cid,
          url: `https://bsky.app/profile/${auth.handle}/post/${rkey}`,
        },
      };
    },
    async reply(account, parent, text) {
      const { credentials, session: auth } = await session(account);
      if (!parent.cid) throw new SocialError("Nothing to reply to.");
      const root = { uri: parent.rootId ?? parent.remoteId, cid: parent.rootCid ?? parent.cid };
      const created = await createRecord(credentials.service, auth, "app.bsky.feed.post", {
        $type: "app.bsky.feed.post",
        text,
        facets: linkFacets(text),
        createdAt: new Date().toISOString(),
        reply: { root, parent: { uri: parent.remoteId, cid: parent.cid } },
      });
      return { remoteId: created.uri, cid: created.cid };
    },
    async remove(account, remoteId) {
      const { credentials, session: auth } = await session(account);
      const response = await publicFetch(new URL(`${credentials.service}/xrpc/com.atproto.repo.deleteRecord`), {
        method: "POST",
        headers: { authorization: `Bearer ${auth.accessJwt}`, "content-type": "application/json" },
        body: JSON.stringify({ repo: auth.did, collection: "app.bsky.feed.post", rkey: remoteId.split("/").pop() }),
        timeoutMs: 15_000,
      });
      await expectOk(response, "Bluesky");
    },
    async comments(_account, post) {
      const response = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=1&uri=${encodeURIComponent(post.remoteId)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const { thread } = await okJson<{
        thread?: {
          replies?: {
            post?: {
              uri: string;
              cid: string;
              author?: { handle?: string };
              record?: { text?: string; createdAt?: string };
            };
          }[];
        };
      }>(response, "Bluesky");
      return (thread?.replies ?? [])
        .filter((reply) => reply.post)
        .map(({ post: item }) => ({
          id: item!.uri,
          cid: item!.cid,
          author: item!.author?.handle ?? "someone",
          text: item!.record?.text ?? "",
          at: item!.record?.createdAt ?? null,
        }));
    },
    async metrics(_account, posts) {
      // Counts are public on Bluesky's AppView: no session needed, and nothing billed.
      const found = new Map<string, PostMetrics>();
      for (let i = 0; i < posts.length; i += 25) {
        const query = posts
          .slice(i, i + 25)
          .map((post) => `uris=${encodeURIComponent(post.remoteId)}`)
          .join("&");
        const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${query}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const { posts: list } = await okJson<{ posts: Record<string, unknown>[] }>(response, "Bluesky");
        for (const post of list) {
          found.set(String(post.uri), {
            likes: count(post.likeCount),
            comments: count(post.replyCount),
            reposts: (count(post.repostCount) ?? 0) + (count(post.quoteCount) ?? 0),
          });
        }
      }
      return found;
    },
    async amplify(account, post) {
      if (!post.cid) throw new SocialError("Nothing to repost.");
      const { credentials, session: auth } = await session(account);
      await createRecord(credentials.service, auth, "app.bsky.feed.repost", {
        $type: "app.bsky.feed.repost",
        subject: { uri: post.remoteId, cid: post.cid },
        createdAt: new Date().toISOString(),
      });
    },
  };
}

export function adapters(): Record<SocialProvider, SocialAdapter> {
  return {
    x: xAdapter(),
    linkedin: linkedinAdapter(),
    bluesky: blueskyAdapter(),
    threads: threadsAdapter(async (account, next) => {
      await convex.mutation(api.accounts.storeCredentials, {
        accountId: account._id,
        sealedCredentials: await sealCredentials(next),
      });
    }),
    facebook: facebookAdapter(),
    instagram: instagramAdapter(),
    tiktok: tiktokAdapter(),
    youtube: youtubeAdapter(),
  };
}
