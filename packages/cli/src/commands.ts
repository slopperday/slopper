import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { ParseArgsOptionsConfig } from "node:util";
import {
  type Api,
  isSystemError,
  postWithoutToken,
  removeConfig,
  SlopperError,
  usageError,
  writeConfig,
} from "./client.ts";
import { readSkill } from "./skill.ts";

/**
 * Every command, each one REST call (or two, for screenshots) against
 * slopper.day's `/api/v1`. Results print as JSON so agents can read them.
 */

export interface Io {
  env: Record<string, string | undefined>;
  home: string;
  /** This machine's name, for the token a browser sign-in makes. */
  hostname: string;
  fetch: typeof fetch;
  /** Piped input, or null when stdin is a terminal. */
  readStdin(): Promise<string | null>;
  /** Opens a page in the default browser; false when it couldn't. */
  openUrl(url: string): Promise<boolean>;
  /** Waits between the browser sign-in's polls. */
  sleep(ms: number): Promise<void>;
  stdout(text: string): void;
  stderr(text: string): void;
}

export type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

/** What every command gets. */
export interface LocalContext {
  values: Values;
  positionals: string[];
  io: Io;
  configFile: string;
}

/** What commands that talk to the site get as well. */
export interface Context extends LocalContext {
  /** The site's origin, already resolved. */
  url: string;
  /** Sent with every request: slopper-cli/<version>. */
  userAgent: string;
  api: Api;
  /** An API client for another token (login checks one before saving it). */
  connect: (token: string) => Api;
}

interface CommandInfo {
  name: string;
  /** Positional arguments, as shown in usage. A command takes no more than these. */
  args?: string;
  summary: string;
  /** Flag → what it does, for `slopper help <command>`. */
  flags?: Record<string, string>;
  options?: ParseArgsOptionsConfig;
  /** Left out of `slopper help`: for admins, documented in the repository only. */
  hidden?: true;
}

/**
 * A command that never talks to the site, so it works without a token, a
 * valid --url or a readable config: `logout` is how people fix a broken one.
 */
interface LocalCommand extends CommandInfo {
  local: true;
  /** JSON to print, a string to print as is, or nothing. */
  run(context: LocalContext): Promise<unknown>;
}

interface SiteCommand extends CommandInfo {
  local?: false;
  /** JSON to print, a string to print as is, or nothing. */
  run(context: Context): Promise<unknown>;
}

export type Command = LocalCommand | SiteCommand;

/**
 * The site's LIMITS.mediaBytes (app/lib/model.ts; the tests check they
 * agree). Bigger screenshots are refused, so they aren't sent.
 */
export const MEDIA_BYTES = 4 * 1024 * 1024;

/** The site's LIMITS.videoBytes, for promo videos. */
export const VIDEO_BYTES = 4 * 1024 * 1024;

/** The site's LIMITS.publicationBytes, for a PDF or EPUB to read on a slop. */
export const PUBLICATION_BYTES = 4 * 1024 * 1024;

function text(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

function list(values: Values, key: string): string[] | undefined {
  const value = values[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : undefined;
}

function wholeNumber(values: Values, key: string): number | undefined {
  const value = text(values, key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw usageError(`--${key} must be a whole number, not “${value}”.`);
  return Number(value);
}

/** `key=value` flags, as an object: `--link-for x=https://…`. */
function pairs(values: Values, key: string): Record<string, string> | undefined {
  const entries = list(values, key);
  if (!entries) return undefined;
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const split = entry.indexOf("=");
    if (split < 1) throw usageError(`--${key} needs key=value.`);
    out[entry.slice(0, split).trim()] = entry.slice(split + 1);
  }
  return out;
}

/** Per-destination media, links and first comments from `--media-for`, `--link-for`, `--comment-for`. */
function variantFlags(values: Values): Record<string, Record<string, unknown>> | undefined {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(pairs(values, "link-for") ?? {})) (out[key] ??= {}).link = value || null;
  for (const [key, value] of Object.entries(pairs(values, "comment-for") ?? {})) (out[key] ??= {}).firstComment = value;
  for (const [key, value] of Object.entries(pairs(values, "media-for") ?? {})) {
    (out[key] ??= {}).media = value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }
  return Object.keys(out).length ? out : undefined;
}

const DESTINATION_FLAGS = {
  "--link-for <network-or-account=url>":
    "Give one network or account its own link (empty for none). Repeat for several.",
  "--comment-for <network-or-account=text>": "Give one network or account its own first comment. Repeat for several.",
  "--media-for <network-or-account=id,id>": "Choose which uploads one network or account gets. Repeat for several.",
  "--time-for <account=when>": "Give one account its own time (a date-time in your time zone). Repeat for several.",
};

const DESTINATION_OPTIONS = {
  "link-for": { type: "string", multiple: true },
  "comment-for": { type: "string", multiple: true },
  "media-for": { type: "string", multiple: true },
  "time-for": { type: "string", multiple: true },
} as const;

function required<T>(value: T | undefined, flag: string): T {
  if (value === undefined) throw usageError(`Missing ${flag}.`);
  return value;
}

function positional(context: LocalContext, index: number, name: string): string {
  const value = context.positionals[index];
  if (!value) throw usageError(`Missing <${name}>.`);
  return value;
}

/** A slop reference as a URL path segment. */
function slopPath(ref: string): string {
  return `/slops/${encodeURIComponent(ref)}`;
}

/** `website=https://…`, or a bare URL for a website. */
export function parseLink(value: string): { kind: string; url: string } {
  const match = /^([a-z_]+)=(.+)$/.exec(value);
  if (match) return { kind: match[1], url: match[2] };
  if (/^https?:\/\//.test(value)) return { kind: "website", url: value };
  throw usageError(`--link takes kind=url (website=https://…, testflight=https://…) or a bare URL, not “${value}”.`);
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function uploadImage(api: Api, file: string): Promise<{ id: string }> {
  const contentType = IMAGE_TYPES[extname(file).toLowerCase()];
  if (!contentType) throw usageError(`${file} isn't a PNG, JPEG, WebP or GIF.`);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(resolve(file)));
  } catch (error) {
    if (!isSystemError(error)) throw error;
    throw usageError(`Couldn't read ${file} (${error.code}).`);
  }
  if (bytes.byteLength > MEDIA_BYTES) {
    throw usageError(`${file} is bigger than ${MEDIA_BYTES / 1024 / 1024} MB, the most a screenshot can be.`);
  }
  const uploaded = await api.upload("/media", bytes, contentType);
  if (typeof uploaded !== "object" || uploaded === null || typeof (uploaded as { id?: unknown }).id !== "string") {
    throw new SlopperError(`Uploading ${file} returned no media id.`);
  }
  return uploaded as { id: string };
}

const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
};

async function uploadVideoFile(api: Api, file: string): Promise<{ id: string }> {
  const contentType = VIDEO_TYPES[extname(file).toLowerCase()];
  if (!contentType) throw usageError(`${file} isn't an MP4 or WebM video.`);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(resolve(file)));
  } catch (error) {
    if (!isSystemError(error)) throw error;
    throw usageError(`Couldn't read ${file} (${error.code}).`);
  }
  if (bytes.byteLength > VIDEO_BYTES) {
    throw usageError(`${file} is bigger than ${VIDEO_BYTES / 1024 / 1024} MB, the most a video can be.`);
  }
  const uploaded = await api.upload("/videos", bytes, contentType);
  if (typeof uploaded !== "object" || uploaded === null || typeof (uploaded as { id?: unknown }).id !== "string") {
    throw new SlopperError(`Uploading ${file} returned no media id.`);
  }
  return uploaded as { id: string };
}

/** The publication formats, by extension. */
const PUBLICATION_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
};

async function uploadPublicationFile(api: Api, file: string): Promise<{ id: string }> {
  const contentType = PUBLICATION_TYPES[extname(file).toLowerCase()];
  if (!contentType) throw usageError(`${file} isn't a PDF or an EPUB.`);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(resolve(file)));
  } catch (error) {
    if (!isSystemError(error)) throw error;
    throw usageError(`Couldn't read ${file} (${error.code}).`);
  }
  if (bytes.byteLength > PUBLICATION_BYTES) {
    throw usageError(`${file} is bigger than ${PUBLICATION_BYTES / 1024 / 1024} MB, the most a publication can be.`);
  }
  const uploaded = await api.upload(`/publications?fileName=${encodeURIComponent(basename(file))}`, bytes, contentType);
  if (typeof uploaded !== "object" || uploaded === null || typeof (uploaded as { id?: unknown }).id !== "string") {
    throw new SlopperError(`Uploading ${file} returned no media id.`);
  }
  return uploaded as { id: string };
}

/** A publication is a PDF or EPUB file, uploaded first, or a media id from an earlier upload. */
async function publicationId(api: Api, value: string): Promise<string> {
  const isFile = value.includes("/") || value.includes("\\") || extname(value).toLowerCase() in PUBLICATION_TYPES;
  return isFile ? (await uploadPublicationFile(api, value)).id : value;
}

/**
 * Screenshots are image files, uploaded first, or media ids from
 * `slopper upload`. Anything with an image extension or a path in it is a file.
 */
async function screenshotIds(api: Api, values: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const value of values) {
    const isFile = value.includes("/") || value.includes("\\") || extname(value).toLowerCase() in IMAGE_TYPES;
    ids.push(isFile ? (await uploadImage(api, value)).id : value);
  }
  return ids;
}

/** The fields `launch` and `edit` share, only those that were passed. */
async function slopFields(context: Context): Promise<Record<string, unknown>> {
  const { values, api } = context;
  const links = list(values, "link");
  const screenshots = list(values, "screenshot");
  const publication = text(values, "publication");
  const madeWith = list(values, "made-with");
  const fields: Record<string, unknown> = {
    name: text(values, "name"),
    tagline: text(values, "tagline"),
    description: text(values, "description"),
    category: text(values, "category"),
    links: links?.map(parseLink),
    screenshots: screenshots ? await screenshotIds(api, screenshots) : undefined,
    publication: publication === undefined ? undefined : await publicationId(api, publication),
    madeWith,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

const SLOP_OPTIONS = {
  name: { type: "string" },
  tagline: { type: "string" },
  description: { type: "string" },
  category: { type: "string" },
  link: { type: "string", multiple: true },
  screenshot: { type: "string", multiple: true },
  publication: { type: "string" },
  "made-with": { type: "string", multiple: true },
} satisfies ParseArgsOptionsConfig;

const SLOP_FLAGS = {
  "--name <name>": "What it's called.",
  "--tagline <line>": "One line: what does it do?",
  "--description <markdown>": "The longer story, in Markdown.",
  "--category <id>": "One of `slopper categories`.",
  "--link <kind=url>":
    "Where to try it; repeat for more. Kinds: website, app_store, testflight, play_store, play_beta, source, other. A bare URL is a website.",
  "--screenshot <file|id>":
    "An image file (uploaded for you) or an id from `slopper upload`; repeat for more. The first is the cover.",
  "--publication <file|id>":
    "A PDF or EPUB you wrote (a book, zine, guide or paper, up to 4 MB), uploaded for you and read from the slop page. With one, --link is optional.",
  "--made-with <tag>":
    "What built it: the model, the harness, the framework; repeat for more. Spellings from `slopper tags`.",
};

const AUTOPOST_FLAG = {
  "--autopost":
    "Also post it to the accounts connected for auto-posting on slopper.day. When it can't be posted yet, the result says why.",
};

/** What /api/cli/login answers: the secret the CLI polls with, and the page the person approves on. */
interface BrowserSignIn {
  deviceCode: string;
  userCode: string;
  url: string;
  interval: number;
}

function isBrowserSignIn(value: unknown): value is BrowserSignIn {
  if (typeof value !== "object" || value === null) return false;
  const { deviceCode, userCode, url, interval } = value as Record<string, unknown>;
  return (
    typeof deviceCode === "string" &&
    typeof userCode === "string" &&
    typeof url === "string" &&
    typeof interval === "number"
  );
}

/** The longest a browser sign-in is polled; the site expires it after ten minutes. */
const SIGN_IN_TIMEOUT_MS = 11 * 60_000;

/**
 * Signs in the way TVs do: the site makes a one-time code, the person
 * approves it at /cli in a browser where they're signed in, and the CLI
 * collects a new API token named after this machine. Progress goes to
 * stderr so stdout stays JSON.
 */
async function signInFromBrowser({ io, url, userAgent }: Context, openBrowser: boolean): Promise<string> {
  const site = { url, fetch: io.fetch, userAgent };
  const started = await postWithoutToken(site, "/api/cli/login", { name: `slopper CLI on ${io.hostname}` });
  if (!isBrowserSignIn(started)) throw new SlopperError(`${url} didn't start a browser sign-in. Is it a Slopper site?`);

  // Match the server's approval route without trusting its URL as a launch target.
  const page = new URL("/cli", url);
  page.searchParams.set("code", started.userCode);

  if (started.url !== page.href) throw new SlopperError(`${url} returned an unexpected sign-in page.`);

  const opened = openBrowser && (await io.openUrl(page.href));
  io.stderr(
    `${opened ? "Opened" : "Open"} ${page.href}\n` +
      `Check the page shows ${started.userCode}, then approve it. Waiting…\n`,
  );
  for (let waited = 0; waited < SIGN_IN_TIMEOUT_MS; waited += started.interval * 1000) {
    await io.sleep(started.interval * 1000);
    const polled = await postWithoutToken(site, "/api/cli/token", { deviceCode: started.deviceCode });
    const status = typeof polled === "object" && polled !== null ? (polled as { status?: unknown }).status : undefined;
    if (status === "pending") continue;
    if (status === "approved") {
      const token = (polled as { token?: unknown }).token;
      if (typeof token === "string" && token) return token;
    }
    if (status === "denied") throw new SlopperError("The sign-in was denied in the browser.");
    if (status === "expired") throw new SlopperError("The sign-in expired. Run `slopper login` again.");
    throw new SlopperError(`${url} answered the sign-in with something unexpected.`);
  }
  throw new SlopperError("Nobody approved the sign-in in time. Run `slopper login` again.");
}

export const COMMANDS: Command[] = [
  {
    name: "login",
    summary: "Sign in from your browser, then save the token and its site for the other commands.",
    flags: {
      "--no-browser": "Print the sign-in link instead of opening it, for a machine without a browser.",
      "--token <token>": "Save this token from /settings/api instead. Piped in, it's read from stdin.",
      "--url <url>": "A different site to save, like a local one.",
    },
    options: { "no-browser": { type: "boolean" } },
    async run(context) {
      const { values, io, url, configFile, connect } = context;
      const given = (text(values, "token") ?? (await io.readStdin()) ?? "").trim();
      const token = given || (await signInFromBrowser(context, values["no-browser"] !== true));
      const me = await connect(token).get("/me");
      const username = typeof me === "object" && me !== null ? (me as { username?: unknown }).username : undefined;
      if (typeof username !== "string") throw new SlopperError(`${url} didn't say whose token this is.`);
      // The token only works on the site that checked it, so they're saved together.
      await writeConfig(configFile, { token, url });
      return { loggedIn: username, url, config: configFile };
    },
  },
  {
    name: "logout",
    summary: "Forget the saved token. Revoke it at /settings/api to cut it off everywhere.",
    local: true,
    async run({ configFile }) {
      await removeConfig(configFile);
      return { loggedOut: true, config: configFile };
    },
  },
  {
    name: "whoami",
    summary: "You: profile, time zone, today's (UTC) date, the open goal, streak and votes left today. Start here.",
    run: ({ api }) => api.get("/me"),
  },
  {
    name: "profile",
    args: "<username>",
    summary:
      "Anyone's profile: their open goal day by day (shipped, missed, today, upcoming), streak and slops. No token needed.",
    run(context) {
      const username = positional(context, 0, "username").replace(/^@/, "");
      return context.api.read(`/users/${encodeURIComponent(username)}`);
    },
  },
  {
    name: "today",
    summary: "Today's race (UTC day): slops ranked by votes, and with a token how you voted and your votes left.",
    run: ({ api }) => api.read("/today"),
  },
  {
    name: "search",
    args: "<query>",
    summary: "Find slops by name or by what they do. It matches meaning as well as words; best match first.",
    flags: {
      "--category <id>": "Only this category. Repeat it for several; ids from `slopper categories`.",
      "--limit <n>": "How many, up to 48. Defaults to 20.",
    },
    options: { category: { type: "string", multiple: true }, limit: { type: "string" } },
    run(context) {
      const params = new URLSearchParams({ q: positional(context, 0, "query") });
      for (const category of list(context.values, "category") ?? []) params.append("category", category);
      const limit = wholeNumber(context.values, "limit");
      if (limit !== undefined) params.set("limit", String(limit));
      return context.api.read(`/search?${params.toString()}`);
    },
  },
  {
    name: "categories",
    summary: "Valid categories, link kinds, currencies and money categories.",
    run: ({ api }) => api.read("/categories"),
  },
  {
    name: "tags",
    summary: "Made-with tags, most used first: models, harnesses, frameworks and platforms.",
    run: ({ api }) => api.read("/tags"),
  },
  {
    name: "goal",
    summary: "Start a goal, like 30 slops in 30 days. Only one can be open.",
    flags: {
      "--target <n>": "Required: how many slops to ship.",
      "--days <n>": "Required: how many days. They end at midnight UTC.",
      "--start <YYYY-MM-DD>": "Today or later. Defaults to today.",
      "--title <title>": "Defaults to “N slops in M days”.",
    },
    options: {
      target: { type: "string" },
      days: { type: "string" },
      start: { type: "string" },
      title: { type: "string" },
    },
    run({ api, values }) {
      return api.post("/goal", {
        target: required(wholeNumber(values, "target"), "--target <n>"),
        days: required(wholeNumber(values, "days"), "--days <n>"),
        startDate: text(values, "start"),
        title: text(values, "title"),
      });
    },
  },
  {
    name: "upload",
    args: "<image>",
    summary:
      "Upload a screenshot (PNG, JPEG, WebP or GIF, up to 4 MB). Prints its id, and nsfw: true when it will blur a slop.",
    run: (context) => uploadImage(context.api, positional(context, 0, "image")),
  },
  {
    name: "slops",
    summary: "Your slops, newest first, with votes, updates, pledges and badges.",
    run: ({ api }) => api.get("/slops"),
  },
  {
    name: "launch",
    summary:
      "Throw a new slop at the wall. It counts towards today's goal and enters today's race, or with --at waits until then.",
    flags: {
      ...SLOP_FLAGS,
      "--note <text>": "The first update, also the auto-post text. Defaults to the tagline.",
      "--relaunch-of <slop>": "Launch an existing product again (a new platform, a 2.0): its id or slug.",
      "--label <label>": "With --relaunch-of: what's launching, like “iOS app” or “2.0”.",
      "--at <when>":
        "Schedule it: “next” (the next day with nothing out or scheduled, as its race starts) or a date-time like 2026-10-15T09:00 (your time zone unless it has an offset).",
      ...AUTOPOST_FLAG,
    },
    options: {
      ...SLOP_OPTIONS,
      note: { type: "string" },
      "relaunch-of": { type: "string" },
      label: { type: "string" },
      at: { type: "string" },
      autopost: { type: "boolean" },
    },
    async run(context) {
      const { api, values } = context;
      return api.post("/slops", {
        ...(await slopFields(context)),
        launchNote: text(values, "note"),
        relaunchOf: text(values, "relaunch-of"),
        launchLabel: text(values, "label"),
        releaseAt: text(values, "at"),
        autopost: values.autopost === true,
      });
    },
  },
  {
    name: "social accounts",
    summary:
      "The social accounts you can post as (X, LinkedIn, Bluesky, Threads, Facebook, Instagram, TikTok, YouTube), with their brands.",
    run: ({ api }) => api.get("/social/accounts"),
  },
  {
    name: "social post",
    args: "<text>",
    summary:
      "Post once as several accounts, each copy fitted to its network. Checked first. --at now|queue|draft|2026-11-24T09:30.",
    flags: {
      "--account <id>": "An account id from `slopper social accounts`. Repeat for each.",
      "--link <url>": "The link, last in each copy.",
      "--image <id>": "An uploaded picture id (upload). Repeat for more.",
      "--thread <text>": "A post that follows as a thread on X, Bluesky and Threads. Repeat for more.",
      "--first-comment <text>": "Posted under it where the network takes comments.",
      "--at <when>": "now (default), queue (next free queue time), draft, or a date-time in your time zone.",
      "--tag <tag>": "A tag for the calendar and analytics. Repeat for more.",
      "--track-links": "Send the link as a per-network short link with UTM tags, counting clicks.",
      "--key <key>": "An idempotency key: the same key again returns the same post.",
      ...DESTINATION_FLAGS,
    },
    options: {
      ...DESTINATION_OPTIONS,
      account: { type: "string", multiple: true },
      link: { type: "string" },
      image: { type: "string", multiple: true },
      thread: { type: "string", multiple: true },
      "first-comment": { type: "string" },
      at: { type: "string" },
      tag: { type: "string", multiple: true },
      "track-links": { type: "boolean" },
      key: { type: "string" },
    },
    run(context) {
      const { api, values } = context;
      return api.post("/social/posts", {
        text: positional(context, 0, "text"),
        // A draft can wait for its accounts (an idea); posting needs them.
        accounts:
          text(values, "at") === "draft"
            ? list(values, "account")
            : required(list(values, "account"), "--account <id>"),
        link: text(values, "link"),
        media: list(values, "image"),
        thread: list(values, "thread"),
        firstComment: text(values, "first-comment"),
        at: text(values, "at"),
        tags: list(values, "tag"),
        trackLinks: values["track-links"] === true,
        variants: variantFlags(values),
        times: pairs(values, "time-for"),
        idempotencyKey: text(values, "key"),
      });
    },
  },
  {
    name: "social posts",
    summary: "Your social posts, newest first: drafts, scheduled and sent, with each account's status and stats.",
    run: ({ api }) => api.get("/social/posts"),
  },
  {
    name: "social status",
    args: "<post>",
    summary: "Where one social post went, each copy's link, and its latest likes, comments, shares and views.",
    run: (context) => context.api.get(`/social/posts/${encodeURIComponent(positional(context, 0, "post"))}`),
  },
  {
    name: "social edit",
    args: "<post>",
    summary: "Edit a draft or unsent scheduled post. Omitted options stay unchanged; use --at to schedule it.",
    flags: {
      "--text <text>": "Replace the post's words.",
      "--options <json>":
        "Network-specific settings as JSON, keyed by youtube, tiktok, instagram or linkedin. Omitted networks stay unchanged.",
      "--copy <account-or-network=text>":
        "Set one account's or network's copy; repeat to change several. An empty value clears the override.",
      "--link <url>": "Replace the link; pass an empty string to clear.",
      "--account <id>": "Replace posting accounts; repeat for each.",
      "--repost-account <id>": "Replace reposting accounts; repeat for each.",
      "--thread <text>": "Replace the thread; repeat for each part.",
      "--first-comment <text>": "Replace the first comment; an empty string clears it.",
      "--tag <tag>": "Replace tags; repeat for each.",
      "--at <when>": "draft, queue, now, or a future date-time in your time zone. Omit to keep the current state.",
      "--media <id>": "Replace attachments with uploaded IDs; repeat for each.",
      "--frame <id>": "A checked frame image id, required for scheduling large videos; repeat up to three.",
      ...DESTINATION_FLAGS,
    },
    options: {
      ...DESTINATION_OPTIONS,
      text: { type: "string" },
      copy: { type: "string", multiple: true },
      options: { type: "string" },
      link: { type: "string" },
      account: { type: "string", multiple: true },
      "repost-account": { type: "string", multiple: true },
      thread: { type: "string", multiple: true },
      "first-comment": { type: "string" },
      tag: { type: "string", multiple: true },
      at: { type: "string" },
      frame: { type: "string", multiple: true },
      media: { type: "string", multiple: true },
    },
    run(context) {
      const { api, values } = context;
      const entries = list(values, "copy");
      const copies: Record<string, string> = {};
      for (const entry of entries ?? []) {
        const split = entry.indexOf("=");
        if (split < 1 || !entry.slice(0, split).trim()) throw usageError("--copy needs account-or-network=text.");
        copies[entry.slice(0, split).trim()] = entry.slice(split + 1);
      }
      let options: unknown;
      const rawOptions = text(values, "options");
      if (rawOptions !== undefined) {
        try {
          options = JSON.parse(rawOptions);
        } catch {
          throw usageError("--options needs a JSON object.");
        }
        if (!options || typeof options !== "object" || Array.isArray(options))
          throw usageError("--options needs a JSON object.");
      }
      return api.patch(`/social/posts/${encodeURIComponent(positional(context, 0, "post"))}`, {
        text: text(values, "text"),
        copy: entries ? copies : undefined,
        options,
        link: text(values, "link"),
        accounts: list(values, "account"),
        repostAccounts: list(values, "repost-account"),
        thread: list(values, "thread"),
        firstComment: text(values, "first-comment"),
        tags: list(values, "tag"),
        at: text(values, "at"),
        frames: list(values, "frame"),
        media: list(values, "media"),
        variantFor: variantFlags(values),
        timeFor: pairs(values, "time-for"),
      });
    },
  },
  {
    name: "social resolve",
    args: "<delivery>",
    summary:
      "Settle a copy that may have gone out: check the account, then --posted (with --link) or --resend. Retries skip these so nothing posts twice.",
    flags: {
      "--posted": "It went out: mark it sent without sending again.",
      "--link <url>": "With --posted: the post's address on the network.",
      "--resend": "It didn't go out: send it again.",
    },
    options: { posted: { type: "boolean" }, link: { type: "string" }, resend: { type: "boolean" } },
    run(context) {
      const { api, values } = context;
      if ((values.posted === true) === (values.resend === true)) throw usageError("Pass --posted or --resend.");
      return api.post(`/social/deliveries/${encodeURIComponent(positional(context, 0, "delivery"))}/resolve`, {
        outcome: values.posted === true ? "posted" : "resend",
        url: text(values, "link"),
      });
    },
  },
  {
    name: "social cancel",
    args: "<post>",
    summary: "Cancel an unsent scheduled post or delete a draft.",
    run: (context) => context.api.delete(`/social/posts/${encodeURIComponent(positional(context, 0, "post"))}`),
  },
  {
    name: "scheduled",
    summary: "Your scheduled launches, soonest first. Nobody else sees them until they go out.",
    run: ({ api }) => api.get("/scheduled"),
  },
  {
    name: "release",
    args: "<scheduled>",
    summary: "Put a scheduled launch out now. It counts towards today's goal and enters today's race.",
    run: (context) =>
      context.api.post(`/scheduled/${encodeURIComponent(positional(context, 0, "scheduled"))}/release`, {}),
  },
  {
    name: "unschedule",
    args: "<scheduled>",
    summary: "Drop a scheduled launch before it goes out.",
    run: (context) => context.api.delete(`/scheduled/${encodeURIComponent(positional(context, 0, "scheduled"))}`),
  },
  {
    name: "edit",
    args: "<slop>",
    summary:
      "Change one of your slops, until the end of the day after its launch (at least 24 hours after launch); then post updates instead. Only the flags you pass change; --link and --screenshot replace the lists.",
    flags: { ...SLOP_FLAGS, "--remove-publication": "Take the slop's PDF or EPUB off." },
    options: { ...SLOP_OPTIONS, "remove-publication": { type: "boolean" } },
    async run(context) {
      const slop = positional(context, 0, "slop");
      if (context.values["remove-publication"] === true && context.values.publication !== undefined) {
        throw usageError("Pass --publication or --remove-publication, not both.");
      }
      const fields = await slopFields(context);
      if (context.values["remove-publication"] === true) fields.publication = null;
      if (Object.keys(fields).length === 0) throw usageError("Nothing to change: pass a flag, like --tagline.");
      return context.api.patch(slopPath(slop), fields);
    },
  },
  {
    name: "video",
    args: "<slop> [file|id]",
    summary:
      "Put a promo video (MP4 or WebM, up to 4 MB) on one of your slops, replacing its last. It plays once a moderator approves it; once one of yours has been approved, later ones can play straight away.",
    flags: { "--remove": "Take the slop's video off instead." },
    options: { remove: { type: "boolean" } },
    async run(context) {
      const { api, values, positionals } = context;
      const slop = positional(context, 0, "slop");
      if (values.remove === true) {
        if (positionals[1] !== undefined) throw usageError("Pass a video or --remove, not both.");
        return api.put(`${slopPath(slop)}/video`, { video: null });
      }
      const video = positional(context, 1, "file|id");
      const isFile = video.includes("/") || video.includes("\\") || extname(video).toLowerCase() in VIDEO_TYPES;
      const id = isFile ? (await uploadVideoFile(api, video)).id : video;
      return api.put(`${slopPath(slop)}/video`, { video: id });
    },
  },
  {
    name: "post",
    args: "<slop>",
    summary: "Post an update on one of your slops.",
    flags: {
      "--kind <kind>":
        "update (fixes, news; the default), feature (something new shipped), field (a real-world test: who tried it, what they said) or repromote.",
      "--body <markdown>": "Required: what happened.",
      "--version <version>": "What shipped, like v1.3.",
      "--image <file|id>": "An image file (uploaded for you) or an id from `slopper upload`; repeat for up to 4.",
      "--link <kind=url>": "A link to go with it, kinds as for launch; repeat for up to 3.",
      "--preview": "Show a preview card (the page's title, description and image) for every --link.",
      "--feature <name>": "With --kind feature: what it's called.",
      "--outcome <worked|mixed|broke>": "With --kind field: how it went.",
      "--who <text>": "With --kind field and --outcome: who tried it.",
      ...AUTOPOST_FLAG,
    },
    options: {
      kind: { type: "string" },
      body: { type: "string" },
      version: { type: "string" },
      image: { type: "string", multiple: true },
      link: { type: "string", multiple: true },
      preview: { type: "boolean" },
      feature: { type: "string" },
      outcome: { type: "string" },
      who: { type: "string" },
      autopost: { type: "boolean" },
    },
    async run(context) {
      const { api, values } = context;
      const slop = positional(context, 0, "slop");
      const body = required(text(values, "body"), "--body <markdown>");
      const links = list(values, "link");
      if (values.preview === true && !links) throw usageError("--preview needs a --link to preview.");
      const images = list(values, "image");
      const fields: Record<string, unknown> = {
        kind: text(values, "kind") ?? "update",
        body,
        version: text(values, "version"),
        images: images ? await screenshotIds(api, images) : undefined,
        links: links?.map((link) => ({ ...parseLink(link), preview: values.preview === true })),
        featureName: text(values, "feature"),
        outcome: text(values, "outcome"),
        who: text(values, "who"),
        autopost: values.autopost === true,
      };
      return api.post(
        `${slopPath(slop)}/updates`,
        Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
      );
    },
  },
  {
    name: "money",
    args: "<slop> <cost|revenue> <amount>",
    summary: "Log a cost (domain, hosting, AI) or revenue for a product, in major units like 12.99.",
    flags: {
      "--currency <code>": "Defaults to USD.",
      "--category <id>": "See `slopper categories`. Defaults to other.",
      "--note <text>": "What it was.",
      "--date <YYYY-MM-DD>": "Defaults to today.",
    },
    options: {
      currency: { type: "string" },
      category: { type: "string" },
      note: { type: "string" },
      date: { type: "string" },
    },
    run(context) {
      const { api, values } = context;
      const slop = positional(context, 0, "slop");
      const kind = positional(context, 1, "cost|revenue");
      if (kind !== "cost" && kind !== "revenue") throw usageError(`Money is a cost or revenue, not “${kind}”.`);
      const amount = positional(context, 2, "amount");
      if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
        throw usageError(`<amount> must be a number above zero, like 12.99, not “${amount}”.`);
      }
      return api.post(`${slopPath(slop)}/money`, {
        kind,
        amount: Number(amount),
        currency: text(values, "currency"),
        category: text(values, "category"),
        note: text(values, "note"),
        date: text(values, "date"),
      });
    },
  },
  {
    name: "vote",
    args: "<slop> <up|down|clear>",
    summary:
      "Vote on a slop by its id (from `slopper today`). You get 5 votes a UTC day; downvotes are private, and clearing one gives it back.",
    run(context) {
      const slop = positional(context, 0, "slop");
      const vote = positional(context, 1, "up|down|clear");
      if (vote !== "up" && vote !== "down" && vote !== "clear") {
        throw usageError(`A vote is up, down or clear, not “${vote}”.`);
      }
      return context.api.post(`${slopPath(slop)}/vote`, { vote });
    },
  },
  {
    name: "review",
    args: "<slop> <works|mixed|broken>",
    summary:
      "Review someone else's slop by its id (from `slopper today` or `slopper search`): how it went, in your words, with screenshots. Writing again replaces your review.",
    flags: {
      "--body <markdown>": "What it is, what you tried, how it went and what broke.",
      "--image <file|id>": "A screenshot file (uploaded for you) or an id from `slopper upload`; repeat for up to 4.",
    },
    options: { body: { type: "string" }, image: { type: "string", multiple: true } },
    async run(context) {
      const { api, values } = context;
      const slop = positional(context, 0, "slop");
      const experience = positional(context, 1, "works|mixed|broken");
      if (experience !== "works" && experience !== "mixed" && experience !== "broken") {
        throw usageError(`How it went is works, mixed or broken, not “${experience}”.`);
      }
      const body = required(text(values, "body"), "--body <markdown>");
      const images = list(values, "image");
      return api.put(`${slopPath(slop)}/reviews/mine`, {
        experience,
        body,
        images: images ? await screenshotIds(api, images) : undefined,
      });
    },
  },
  {
    name: "reviews",
    args: "<slop>",
    summary:
      "What people who tried a slop said, newest first. On your own slops (by id or slug), that's your feedback.",
    run(context) {
      return context.api.read(`${slopPath(positional(context, 0, "slop"))}/reviews`);
    },
  },
  {
    name: "analytics",
    args: "<slop>",
    summary:
      "How one of your slops is doing: views and people (against the days before), where they came from, what they clicked, votes and pledges.",
    flags: { "--days <n>": "How far back, from 1 to 90. Defaults to 30." },
    options: { days: { type: "string" } },
    run(context) {
      const slop = positional(context, 0, "slop");
      const days = wholeNumber(context.values, "days");
      return context.api.get(`${slopPath(slop)}/analytics${days === undefined ? "" : `?days=${days}`}`);
    },
  },
  // Admins' platform analytics: undocumented outside the repository (AGENTS.md has it).
  {
    name: "admin",
    args: "analytics [report]",
    summary:
      "Slopper's own analytics, for admins: overview, growth, projects, traffic, trends, funnel, retention, paths, stickiness, lifecycle, people, person, live, events, flags, experiments, experiment, recordings, heatmap, errors, error, vitals, surveys or survey.",
    flags: {
      "--days <n>": "How far back, from 1 to 365. Defaults to 30.",
      "--event <name>": "An event, for trends, funnel steps, stickiness and lifecycle. Repeat for more.",
      "--step-path <path>": "For funnels: the page each step's event happened on, in order. Repeat per step.",
      "--math <total|persons|sessions>": "For trends: count events, people or sessions.",
      "--breakdown <key>": "For trends: split by an event property, or path.",
      "--interval <day|week|month>": "How to bucket time.",
      "--start <event|path>": "Retention's first event, or where journeys start.",
      "--return <event>": "Retention's coming-back event.",
      "--end <path>": "Where journeys lead.",
      "--q <@username|id|key>": "For person: who. For experiment or survey: its key. For error: its fingerprint.",
      "--path <path>": "For heatmap: the page, like /wall.",
      "--device <mobile|tablet|desktop>": "For heatmap: the kind of screen.",
    },
    options: {
      days: { type: "string" },
      event: { type: "string", multiple: true },
      "step-path": { type: "string", multiple: true },
      math: { type: "string" },
      breakdown: { type: "string" },
      interval: { type: "string" },
      start: { type: "string" },
      return: { type: "string" },
      end: { type: "string" },
      steps: { type: "string" },
      window: { type: "string" },
      periods: { type: "string" },
      q: { type: "string" },
      after: { type: "string" },
      path: { type: "string" },
      device: { type: "string" },
    },
    hidden: true,
    run(context) {
      const area = positional(context, 0, "area");
      if (area !== "analytics") throw usageError(`Unknown admin area “${area}”. Try \`slopper admin analytics\`.`);
      const params = new URLSearchParams({ report: context.positionals[1] ?? "overview" });
      for (const key of [
        "days",
        "math",
        "breakdown",
        "interval",
        "start",
        "return",
        "end",
        "steps",
        "window",
        "periods",
        "q",
        "after",
        "path",
        "device",
      ]) {
        const value = text(context.values, key);
        if (value !== undefined) params.set(key, value);
      }
      for (const event of list(context.values, "event") ?? []) params.append("event", event);
      for (const path of list(context.values, "step-path") ?? []) params.append("stepPath", path);
      return context.api.get(`/admin/analytics?${params.toString()}`);
    },
  },
  {
    name: "skill",
    args: "[install]",
    summary: "Print the agent skill for this CLI, or install it for your agents.",
    flags: {
      "--dir <dir>":
        "With install: the skills directory. Defaults to ~/.agents/skills; Claude Code reads ~/.claude/skills.",
    },
    options: { dir: { type: "string" } },
    local: true,
    async run(context) {
      const skill = await readSkill();
      const action = context.positionals[0];
      if (action === undefined) return skill;
      if (action !== "install") throw usageError(`Unknown skill action “${action}”. Try \`slopper skill install\`.`);
      const directory = join(
        resolve(text(context.values, "dir") ?? join(context.io.home, ".agents", "skills")),
        "slopper",
      );
      await mkdir(directory, { recursive: true });
      const path = join(directory, "SKILL.md");
      await writeFile(path, skill);
      return { installed: path };
    },
  },
];
