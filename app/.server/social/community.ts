import { composeFor } from "~/lib/compose";
import { publicFetch } from "../preview";
import { assertPublicService } from "./adapters";
import {
  type ConnectedAccount,
  contentToDraft,
  count,
  type DraftMedia,
  expectOk,
  loadMedia,
  okJson,
  openCredentials,
  type PostMetrics,
  type SocialAdapter,
  SocialError,
} from "./core";

export interface MastodonCredentials {
  kind: "mastodon";
  service: string;
  accessToken: string;
}

export interface DiscordCredentials {
  kind: "discord";
  webhookUrl: string;
  channelId: string;
  guildId?: string;
}

export interface TelegramCredentials {
  kind: "telegram";
  botToken: string;
  chatId: string;
  handle: string;
}

export interface RedditCredentials {
  kind: "reddit";
  subreddit: string;
  accessToken: string;
}

// ---------------------------------------------------------------------------
// Mastodon

export function normalizeMastodonService(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "https://mastodon.social";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function fetchMastodonAccount(serviceRaw: string, accessToken: string) {
  const service = normalizeMastodonService(serviceRaw);
  await assertPublicService(service);
  const response = await publicFetch(new URL(`${service}/api/v1/accounts/verify_credentials`), {
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 15_000,
  });
  await expectOk(response, "Mastodon");
  const account = (await response.json()) as {
    id?: string;
    username?: string;
    acct?: string;
    display_name?: string;
    avatar?: string;
    url?: string;
  };
  if (!account.id || !account.username) {
    throw new SocialError("Mastodon didn't return an account. Check the instance URL and access token.");
  }
  const host = new URL(service).hostname;
  return {
    service,
    id: account.id,
    handle: `${account.username}@${host}`,
    displayName: account.display_name?.trim() || account.username,
    avatarUrl: account.avatar ?? null,
  };
}

export function mastodonAdapter(): SocialAdapter {
  async function open(account: ConnectedAccount) {
    const credentials = await openCredentials<MastodonCredentials>(account);
    await assertPublicService(credentials.service);
    return credentials;
  }

  async function uploadMedia(credentials: MastodonCredentials, media: DraftMedia): Promise<string> {
    await assertPublicService(credentials.service);
    const bytes = await loadMedia(media);
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: media.contentType }), "upload");
    if (media.alt?.trim()) form.set("description", media.alt.trim().slice(0, 1500));
    const response = await fetch(`${credentials.service}/api/v2/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${credentials.accessToken}` },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    const data = await okJson<{ id: string }>(response, "Mastodon");
    return data.id;
  }

  async function postStatus(
    credentials: MastodonCredentials,
    status: string,
    mediaIds: readonly string[] = [],
    inReplyToId?: string,
  ) {
    const response = await publicFetch(new URL(`${credentials.service}/api/v1/statuses`), {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status,
        ...(mediaIds.length > 0 ? { media_ids: mediaIds } : {}),
        ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
      }),
      timeoutMs: 20_000,
    });
    const created = await okJson<{ id: string; url?: string; uri?: string }>(response, "Mastodon");
    return {
      provider: "mastodon" as const,
      remoteId: created.id,
      url:
        created.url ?? created.uri ?? `${credentials.service}/@${accountHandleName(credentials.service)}/${created.id}`,
    };
  }

  return {
    async publish(account, content) {
      const credentials = await open(account);
      return await postStatus(credentials, composeFor("mastodon", content));
    },
    async send(account, draft) {
      const credentials = await open(account);
      const mediaIds: string[] = [];
      for (const item of draft.media.slice(0, 4)) {
        mediaIds.push(await uploadMedia(credentials, item));
      }
      return {
        status: "ok",
        post: await postStatus(credentials, draft.text, mediaIds),
      };
    },
    async reply(account, parent, text) {
      const credentials = await open(account);
      const created = await postStatus(credentials, text, [], parent.remoteId);
      return { remoteId: created.remoteId };
    },
    async remove(account, remoteId) {
      const credentials = await open(account);
      const response = await publicFetch(
        new URL(`${credentials.service}/api/v1/statuses/${encodeURIComponent(remoteId)}`),
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${credentials.accessToken}` },
          timeoutMs: 15_000,
        },
      );
      if (response.status !== 404) await expectOk(response, "Mastodon");
    },
    async metrics(account, posts) {
      const credentials = await open(account);
      const found = new Map<string, PostMetrics>();
      for (const post of posts) {
        const response = await publicFetch(
          new URL(`${credentials.service}/api/v1/statuses/${encodeURIComponent(post.remoteId)}`),
          {
            headers: { authorization: `Bearer ${credentials.accessToken}` },
            timeoutMs: 15_000,
          },
        );
        if (!response.ok) continue;
        const item = (await response.json()) as Record<string, unknown>;
        found.set(post.remoteId, {
          likes: count(item.favourites_count),
          comments: count(item.replies_count),
          reposts: count(item.reblogs_count),
        });
      }
      return found;
    },
    async amplify(account, post) {
      const credentials = await open(account);
      const response = await publicFetch(
        new URL(`${credentials.service}/api/v1/statuses/${encodeURIComponent(post.remoteId)}/reblog`),
        {
          method: "POST",
          headers: { authorization: `Bearer ${credentials.accessToken}` },
          timeoutMs: 15_000,
        },
      );
      await expectOk(response, "Mastodon");
    },
  };
}

function accountHandleName(service: string): string {
  try {
    return new URL(service).hostname;
  } catch {
    return "mastodon";
  }
}

// ---------------------------------------------------------------------------
// Discord (Webhook)

const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d+)\/([A-Za-z0-9_-]+)$/;

export function parseDiscordWebhookUrl(raw: string): { url: string; id: string } {
  const clean = raw.trim().replace(/\?.*$/, "").replace(/\/+$/, "");
  const match = DISCORD_WEBHOOK_RE.exec(clean);
  if (!match) {
    throw new SocialError("Paste a Discord channel webhook URL (https://discord.com/api/webhooks/...).");
  }
  return { url: clean, id: match[1] };
}

export async function fetchDiscordWebhook(webhookUrlRaw: string) {
  const { url, id } = parseDiscordWebhookUrl(webhookUrlRaw);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  await expectOk(response, "Discord");
  const data = (await response.json()) as {
    id?: string;
    name?: string;
    channel_id?: string;
    guild_id?: string;
    avatar?: string | null;
  };
  const webhookId = data.id ?? id;
  const name = data.name?.trim() || `Webhook ${webhookId.slice(-4)}`;
  const avatarUrl = data.avatar && data.id ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : null;
  return {
    id: webhookId,
    webhookUrl: url,
    name,
    channelId: data.channel_id ?? webhookId,
    guildId: data.guild_id,
    avatarUrl,
  };
}

export function discordAdapter(): SocialAdapter {
  async function sendWebhook(account: ConnectedAccount, text: string, media: readonly DraftMedia[]) {
    const credentials = await openCredentials<DiscordCredentials>(account);
    const { url } = parseDiscordWebhookUrl(credentials.webhookUrl);
    const endpoint = `${url}?wait=true`;
    let response: Response;
    if (media.length === 0) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 2000) }),
        signal: AbortSignal.timeout(20_000),
      });
    } else {
      const form = new FormData();
      form.set("payload_json", JSON.stringify({ content: text.slice(0, 2000) }));
      for (const [index, item] of media.slice(0, 10).entries()) {
        const bytes = await loadMedia(item);
        const ext = item.kind === "video" ? "mp4" : "jpg";
        form.set(`files[${index}]`, new Blob([bytes], { type: item.contentType }), `media-${index}.${ext}`);
      }
      response = await fetch(endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
    }
    const created = await okJson<{ id: string; channel_id?: string }>(response, "Discord");
    const channelId = created.channel_id ?? credentials.channelId;
    const messageUrl = credentials.guildId
      ? `https://discord.com/channels/${credentials.guildId}/${channelId}/${created.id}`
      : `https://discord.com/channels/@me/${channelId}/${created.id}`;
    return {
      provider: "discord" as const,
      remoteId: created.id,
      url: messageUrl,
    };
  }

  return {
    async publish(account, content) {
      return await sendWebhook(account, composeFor("discord", content), []);
    },
    async send(account, draft) {
      return {
        status: "ok",
        post: await sendWebhook(account, draft.text, draft.media),
      };
    },
    async remove(account, remoteId) {
      const credentials = await openCredentials<DiscordCredentials>(account);
      const { url } = parseDiscordWebhookUrl(credentials.webhookUrl);
      const response = await fetch(`${url}/messages/${encodeURIComponent(remoteId)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 404) await expectOk(response, "Discord");
    },
  };
}

// ---------------------------------------------------------------------------
// Telegram (Bot + Channel/Group)

const TELEGRAM_API = "https://api.telegram.org";

export async function fetchTelegramChannel(botTokenRaw: string, chatIdRaw: string) {
  const botToken = botTokenRaw.trim();
  const chatTarget = chatIdRaw.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    throw new SocialError("Enter a valid Telegram Bot token from @BotFather (e.g. 123456:ABC-DEF...).");
  }
  if (!chatTarget) {
    throw new SocialError("Enter your Telegram channel @username or numeric chat ID.");
  }
  const normalizedTarget = /^-?\d+$/.test(chatTarget) || chatTarget.startsWith("@") ? chatTarget : `@${chatTarget}`;
  const response = await fetch(
    `${TELEGRAM_API}/bot${botToken}/getChat?chat_id=${encodeURIComponent(normalizedTarget)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  await expectOk(response, "Telegram");
  const body = (await response.json()) as {
    ok?: boolean;
    result?: { id: number | string; title?: string; username?: string };
  };
  if (!body.ok || !body.result) {
    throw new SocialError("Telegram couldn't find that channel or the bot isn't an admin there.");
  }
  const chatId = String(body.result.id);
  const handle = body.result.username || chatTarget.replace(/^@/, "");
  const displayName = body.result.title?.trim() || handle;
  return {
    botToken,
    chatId,
    handle,
    displayName,
  };
}

export function telegramAdapter(): SocialAdapter {
  async function sendTelegram(
    account: ConnectedAccount,
    text: string,
    media: readonly DraftMedia[],
    replyToMessageId?: string,
  ) {
    const credentials = await openCredentials<TelegramCredentials>(account);
    const base = `${TELEGRAM_API}/bot${credentials.botToken}`;
    const replyParams =
      replyToMessageId && /^\d+$/.test(replyToMessageId)
        ? { reply_parameters: { message_id: Number(replyToMessageId) } }
        : {};

    let response: Response;
    if (media.length === 0) {
      response = await fetch(`${base}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: credentials.chatId,
          text: text.slice(0, 4096),
          ...replyParams,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } else {
      const first = media[0];
      const endpoint = first.kind === "video" ? "sendVideo" : "sendPhoto";
      const field = first.kind === "video" ? "video" : "photo";
      const bytes = await loadMedia(first);
      const form = new FormData();
      form.set("chat_id", credentials.chatId);
      form.set("caption", text.slice(0, 1024));
      form.set(
        field,
        new Blob([bytes], { type: first.contentType }),
        first.kind === "video" ? "video.mp4" : "photo.jpg",
      );
      response = await fetch(`${base}/${endpoint}`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
    }
    const data = await okJson<{ result: { message_id: number } }>(response, "Telegram");
    const msgId = String(data.result.message_id);
    const cleanHandle = credentials.handle.replace(/^@/, "");
    return {
      provider: "telegram" as const,
      remoteId: msgId,
      url: cleanHandle && !/^-?\d+$/.test(cleanHandle) ? `https://t.me/${cleanHandle}/${msgId}` : `https://t.me/`,
    };
  }

  return {
    async publish(account, content) {
      return await sendTelegram(account, composeFor("telegram", content), []);
    },
    async send(account, draft) {
      return {
        status: "ok",
        post: await sendTelegram(account, draft.text, draft.media),
      };
    },
    async reply(account, parent, text) {
      const post = await sendTelegram(account, text, [], parent.remoteId);
      return { remoteId: post.remoteId };
    },
    async remove(account, remoteId) {
      const credentials = await openCredentials<TelegramCredentials>(account);
      const response = await fetch(`${TELEGRAM_API}/bot${credentials.botToken}/deleteMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: credentials.chatId, message_id: Number(remoteId) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 404) await expectOk(response, "Telegram");
    },
  };
}

// ---------------------------------------------------------------------------
// Reddit

const REDDIT_OAUTH = "https://oauth.reddit.com";
const REDDIT_UA = "web:slopper.studio:v1.0";

export async function fetchRedditSubreddit(subredditRaw: string, accessTokenRaw: string) {
  const subreddit = subredditRaw
    .trim()
    .replace(/^\/?r\//i, "")
    .replace(/\/+$/, "");
  const accessToken = accessTokenRaw.trim();
  if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
    throw new SocialError("Enter a valid subreddit name (e.g. sideproject or r/indiehackers).");
  }
  const response = await fetch(`${REDDIT_OAUTH}/r/${encodeURIComponent(subreddit)}/about`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "user-agent": REDDIT_UA,
    },
    signal: AbortSignal.timeout(15_000),
  });
  await expectOk(response, "Reddit");
  const body = (await response.json()) as {
    data?: {
      id?: string;
      display_name?: string;
      title?: string;
      community_icon?: string;
      icon_img?: string;
    };
  };
  const name = body.data?.display_name || subreddit;
  const icon = (body.data?.community_icon || body.data?.icon_img || "").split("?")[0] || null;
  return {
    id: body.data?.id ? `t5_${body.data.id}` : `r/${name}`,
    subreddit: name,
    handle: `r/${name}`,
    displayName: body.data?.title?.trim() || `r/${name}`,
    avatarUrl: icon,
  };
}

function splitRedditTitleAndBody(text: string): { title: string; selftext: string } {
  const lines = text.trim().split(/\r?\n/);
  const first = (lines[0] ?? "Update").trim();
  const title = first.length <= 300 ? first : `${first.slice(0, 297)}...`;
  const rest = lines.slice(1).join("\n").trim();
  return { title: title || "Update", selftext: rest };
}

export function redditAdapter(): SocialAdapter {
  async function submit(account: ConnectedAccount, title: string, bodyOrUrl: { selftext?: string; url?: string }) {
    const credentials = await openCredentials<RedditCredentials>(account);
    const params = new URLSearchParams({
      api_type: "json",
      sr: credentials.subreddit,
      title: title.slice(0, 300),
      kind: bodyOrUrl.url ? "link" : "self",
      resubmit: "true",
      ...(bodyOrUrl.url ? { url: bodyOrUrl.url } : { text: bodyOrUrl.selftext ?? "" }),
    });
    const response = await fetch(`${REDDIT_OAUTH}/api/submit`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": REDDIT_UA,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await okJson<{
      json?: {
        errors?: [string, string][];
        data?: { id?: string; name?: string; url?: string };
      };
    }>(response, "Reddit");
    const errors = result.json?.errors ?? [];
    if (errors.length > 0) {
      throw new SocialError(`Reddit turned it down: ${errors.map((e) => e[1] || e[0]).join("; ")}`);
    }
    const name = result.json?.data?.name ?? result.json?.data?.id ?? "";
    const url = result.json?.data?.url ?? `https://www.reddit.com/r/${credentials.subreddit}/`;
    return {
      provider: "reddit" as const,
      remoteId: name,
      url,
    };
  }

  return {
    async publish(account, content) {
      const draft = contentToDraft(composeFor("reddit", content), content);
      return await submit(account, content.title || splitRedditTitleAndBody(draft.text).title, {
        url: content.url,
      });
    },
    async send(account, draft) {
      const { title, selftext } = splitRedditTitleAndBody(draft.text);
      const post = await submit(
        account,
        title,
        draft.link && !selftext ? { url: draft.link } : { selftext: selftext || draft.text },
      );
      return { status: "ok", post };
    },
    async reply(account, parent, text) {
      const credentials = await openCredentials<RedditCredentials>(account);
      const thingId = parent.remoteId.startsWith("t") ? parent.remoteId : `t3_${parent.remoteId}`;
      const params = new URLSearchParams({
        api_type: "json",
        thing_id: thingId,
        text,
      });
      const response = await fetch(`${REDDIT_OAUTH}/api/comment`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": REDDIT_UA,
        },
        body: params.toString(),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await okJson<{ json?: { data?: { things?: { data?: { name?: string } }[] } } }>(response, "Reddit");
      const remoteId = data.json?.data?.things?.[0]?.data?.name ?? "";
      return { remoteId };
    },
    async remove(account, remoteId) {
      const credentials = await openCredentials<RedditCredentials>(account);
      const thingId = remoteId.startsWith("t") ? remoteId : `t3_${remoteId}`;
      const response = await fetch(`${REDDIT_OAUTH}/api/del`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": REDDIT_UA,
        },
        body: new URLSearchParams({ id: thingId }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      await expectOk(response, "Reddit");
    },
    async metrics(account, posts) {
      const credentials = await openCredentials<RedditCredentials>(account);
      const found = new Map<string, PostMetrics>();
      const ids = posts.map((p) => (p.remoteId.startsWith("t") ? p.remoteId : `t3_${p.remoteId}`));
      if (ids.length === 0) return found;
      const response = await fetch(`${REDDIT_OAUTH}/api/info?id=${encodeURIComponent(ids.join(","))}`, {
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          "user-agent": REDDIT_UA,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return found;
      const body = (await response.json()) as {
        data?: { children?: { data?: Record<string, unknown> }[] };
      };
      for (const child of body.data?.children ?? []) {
        const d = child.data;
        if (!d) continue;
        const name = typeof d.name === "string" ? d.name : "";
        if (!name) continue;
        found.set(name, {
          likes: count(d.score),
          comments: count(d.num_comments),
        });
      }
      return found;
    },
  };
}
