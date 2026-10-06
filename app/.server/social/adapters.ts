import type { Kv } from "@deno/kv";
import type { ConnectedAccount, SocialProvider } from "~/lib/model";
import { seal, unseal } from "../crypto";
import { clientCredentials, refreshTokens } from "../auth/oauth";
import { storeCredentials } from "../db/accounts";
import { getMediaMeta, readMediaBytes } from "../db/media";
import { composeFor, type PostContent } from "~/lib/compose";

/**
 * Network adapters. Each one turns `PostContent` into a real post and, where
 * the network supports it, reposts another account's post ("amplify").
 */

export interface PublishedPost {
  provider: SocialProvider;
  remoteId: string;
  url: string;
  /** Network specific reference needed to repost (Bluesky CID). */
  cid?: string;
}

export interface SocialAdapter {
  publish(account: ConnectedAccount, content: PostContent): Promise<PublishedPost>;
  /** Absent when the network has no API for reposting. */
  amplify?(account: ConnectedAccount, post: PublishedPost): Promise<void>;
}

export class SocialError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

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

export async function sealCredentials(
  credentials: XCredentials | LinkedInCredentials | BlueskyCredentials,
): Promise<string> {
  return await seal(JSON.stringify(credentials));
}

async function openCredentials<T>(account: ConnectedAccount): Promise<T> {
  return JSON.parse(await unseal(account.sealedCredentials)) as T;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const detail = json.detail ?? json.message ?? json.error_description ?? json.title ?? json.error;
    if (typeof detail === "string") return detail;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return text.slice(0, 200) || response.statusText;
}

async function expectOk(response: Response, network: string) {
  if (response.ok) return;
  throw new SocialError(`${network} said ${response.status}: ${await readError(response)}`, response.status);
}

async function loadImage(
  kv: Kv,
  mediaId: string | null,
  maxBytes: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  if (!mediaId) return null;
  const meta = await getMediaMeta(kv, mediaId);
  if (!meta || meta.size > maxBytes) return null;
  return {
    bytes: await readMediaBytes(kv, meta),
    contentType: meta.contentType,
  };
}

// ---------------------------------------------------------------------------
// X

const X_API = "https://api.x.com/2";

export function xAdapter(kv: Kv): SocialAdapter {
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
    await storeCredentials(kv, account, await sealCredentials(next), null);
    return next.accessToken;
  }

  return {
    async publish(account, content) {
      const response = await fetch(`${X_API}/tweets`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await accessToken(account)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: composeFor("x", content) }),
      });
      await expectOk(response, "X");
      const { data } = (await response.json()) as { data: { id: string } };
      return {
        provider: "x",
        remoteId: data.id,
        url: `https://x.com/${account.handle}/status/${data.id}`,
      };
    },
    async amplify(account, post) {
      const response = await fetch(`${X_API}/users/${account.remoteId}/retweets`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await accessToken(account)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tweet_id: post.remoteId }),
      });
      await expectOk(response, "X");
    },
  };
}

export async function fetchXProfile(accessToken: string) {
  const response = await fetch(`${X_API}/users/me?user.fields=profile_image_url`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  await expectOk(response, "X");
  const { data } = (await response.json()) as {
    data: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    };
  };
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

export function linkedinAdapter(kv: Kv): SocialAdapter {
  function headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "linkedin-version": LINKEDIN_VERSION,
      "x-restli-protocol-version": "2.0.0",
    };
  }

  async function uploadThumbnail(token: string, owner: string, mediaId: string | null): Promise<string | null> {
    const image = await loadImage(kv, mediaId, 5 * 1024 * 1024);
    if (!image) return null;
    const init = await fetch(`${LINKEDIN_API}/images?action=initializeUpload`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    });
    await expectOk(init, "LinkedIn");
    const { value } = (await init.json()) as {
      value: { uploadUrl: string; image: string };
    };
    const upload = await fetch(value.uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: image.bytes,
    });
    await expectOk(upload, "LinkedIn");
    return value.image;
  }

  return {
    async publish(account, content) {
      const credentials = await openCredentials<LinkedInCredentials>(account);
      if (credentials.expiresAt && Date.parse(credentials.expiresAt) < Date.now()) {
        throw new SocialError("LinkedIn connections last 60 days. Reconnect the account.");
      }
      const token = credentials.accessToken;
      const thumbnail = await uploadThumbnail(token, credentials.personUrn, content.imageMediaId).catch(() => null);

      const response = await fetch(`${LINKEDIN_API}/posts`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          author: credentials.personUrn,
          commentary: escapeLittleText(composeFor("linkedin", content)),
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          content: {
            article: {
              source: content.url,
              title: content.title,
              description: content.description,
              ...(thumbnail ? { thumbnail } : {}),
            },
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        }),
      });
      await expectOk(response, "LinkedIn");
      const urn = response.headers.get("x-restli-id") ?? "";
      return {
        provider: "linkedin",
        remoteId: urn,
        url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : "https://www.linkedin.com/feed/",
      };
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

export async function createBlueskySession(credentials: BlueskyCredentials): Promise<BlueskySession> {
  const response = await fetch(`${credentials.service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: credentials.identifier,
      password: credentials.appPassword,
    }),
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

export function blueskyAdapter(kv: Kv): SocialAdapter {
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
    const response = await fetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.accessJwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ repo: auth.did, collection, record }),
    });
    await expectOk(response, "Bluesky");
    return (await response.json()) as { uri: string; cid: string };
  }

  return {
    async publish(account, content) {
      const { credentials, session: auth } = await session(account);
      const text = composeFor("bluesky", content);
      const image = await loadImage(kv, content.imageMediaId, 950_000);
      let thumb: unknown = undefined;
      if (image) {
        const upload = await fetch(`${credentials.service}/xrpc/com.atproto.repo.uploadBlob`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${auth.accessJwt}`,
            "content-type": image.contentType,
          },
          body: image.bytes,
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

export function adaptersFor(kv: Kv): Record<SocialProvider, SocialAdapter> {
  return {
    x: xAdapter(kv),
    linkedin: linkedinAdapter(kv),
    bluesky: blueskyAdapter(kv),
  };
}
