import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
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
  const madeWith = list(values, "made-with");
  const fields: Record<string, unknown> = {
    name: text(values, "name"),
    tagline: text(values, "tagline"),
    description: text(values, "description"),
    category: text(values, "category"),
    links: links?.map(parseLink),
    screenshots: screenshots ? await screenshotIds(api, screenshots) : undefined,
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
  "--made-with <tool>": "What built it; repeat for more.",
};

const AUTOPOST_FLAG = {
  "--autopost":
    "Also post it to the connected X, LinkedIn and Bluesky accounts. When it can't be posted yet, the result says why.",
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

  const opened = openBrowser && (await io.openUrl(started.url));
  io.stderr(
    `${opened ? "Opened" : "Open"} ${started.url}\n` +
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
    summary: "You: profile, time zone, today's date, the open goal, streak and votes left today. Start here.",
    run: ({ api }) => api.get("/me"),
  },
  {
    name: "today",
    summary: "Today's race (UTC day): slops ranked by votes, how you voted, and your votes left.",
    run: ({ api }) => api.get("/today"),
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
      return context.api.get(`/search?${params.toString()}`);
    },
  },
  {
    name: "categories",
    summary: "Valid categories, link kinds, currencies and money categories.",
    run: ({ api }) => api.get("/categories"),
  },
  {
    name: "goal",
    summary: "Start a goal, like 30 slops in 30 days. Only one can be open.",
    flags: {
      "--target <n>": "Required: how many slops to ship.",
      "--days <n>": "Required: how many days. They end at midnight in your time zone.",
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
      "Change one of your slops, until the end of its launch day (at least 12 hours after launch); then post updates instead. Only the flags you pass change; --link and --screenshot replace the lists.",
    flags: SLOP_FLAGS,
    options: SLOP_OPTIONS,
    async run(context) {
      const slop = positional(context, 0, "slop");
      const fields = await slopFields(context);
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
      "Slopper's own analytics, for admins: overview, growth, projects, traffic, trends, funnel, retention, paths, stickiness, lifecycle, people, person, live or events.",
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
      "--q <@username|id>": "For person: who.",
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
