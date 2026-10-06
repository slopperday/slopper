import type { Kv } from "@deno/kv";
import {
  CATEGORIES,
  isPostableUpdateKind,
  LIMITS,
  LINK_KINDS,
  POSTABLE_UPDATE_KINDS,
  type Slop,
  type User,
} from "~/lib/model";
import { localDate } from "~/lib/dates";
import { mediaUrl, slopPath } from "~/lib/display";
import { absoluteUrl } from "../config";
import { addUpdate } from "../db/activity";
import { dayRace, utcDate } from "../db/daily";
import { createGoal, getOpenGoal } from "../db/goals";
import { ownedMediaIds, saveMedia } from "../db/media";
import { allowAction } from "../db/misc";
import {
  createSlop,
  editSlop,
  getSlop,
  getSlopBySlug,
  listUserSlops,
  type Relaunch,
  setSlopcessful,
} from "../db/slops";
import { getUsersById } from "../feed";
import { validateGoal, validateSlop } from "../forms";
import { slopperCard } from "../leaderboard";
import { invalidateFeeds } from "../memo";
import { announce } from "../social/announce";
import {
  ApiError,
  asObject,
  type JsonObject,
  optionalBoolean,
  optionalLinks,
  optionalNumber,
  optionalString,
  optionalStrings,
  requiredString,
} from "./input";

/**
 * Everything an agent can do on Slopper. The MCP server lists these as
 * tools and the REST API maps routes onto them, so both share one
 * implementation and one validation path with the web forms.
 */

export interface OperationContext {
  kv: Kv;
  user: User;
  now: Date;
}

/** JSON Schema for a tool's input object. */
export interface InputSchema {
  type: "object";
  properties: Record<string, JsonObject>;
  required?: string[];
}

export interface Operation {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  readOnly: boolean;
  run(context: OperationContext, input: JsonObject): Promise<unknown>;
}

function summarizeSlop(slop: Slop, username: string) {
  return {
    id: slop.id,
    number: slop.number,
    slug: slop.slug,
    productId: slop.productId,
    launchLabel: slop.launchLabel,
    name: slop.name,
    tagline: slop.tagline,
    url: absoluteUrl(slopPath(username, slop.slug)),
    launchDate: slop.launchDate,
    goalDay: slop.goalDay,
    upvotes: slop.upvotes,
    updates: slop.updateCount,
    fieldTests: slop.fieldTests,
    feedback: slop.commentCount,
    slopOfTheDay: slop.slopOfTheDay,
    slopcessful: slop.slopcessfulAt ? { at: slop.slopcessfulAt, note: slop.slopcessfulNote } : null,
  };
}

/** Finds one of the caller's slops by id or slug. */
async function ownSlop(context: OperationContext, input: JsonObject): Promise<Slop> {
  const ref = requiredString(input, "slop").trim();
  const slop = (await getSlop(context.kv, ref)) ?? (await getSlopBySlug(context.kv, context.user.id, ref));
  if (!slop || slop.userId !== context.user.id) throw new ApiError(404, `No slop of yours matches “${ref}”.`);
  return slop;
}

async function rateLimit(context: OperationContext, bucket: string, limit: number, windowMs: number) {
  if (!(await allowAction(context.kv, bucket, context.user.id, limit, windowMs))) {
    throw new ApiError(429, "Rate limit reached. Try again later.");
  }
}

const SLOP_REF = {
  type: "string",
  description: "The slop's id or slug (from list_my_slops or create_slop).",
};

const LINKS_SCHEMA = {
  type: "array",
  description: "Where people can try it. At least one. Store links must use their store's domain.",
  items: {
    type: "object",
    properties: {
      kind: { type: "string", enum: Object.keys(LINK_KINDS) },
      url: { type: "string", description: "https URL" },
    },
    required: ["kind", "url"],
  },
  maxItems: LIMITS.links,
};

const AUTOPOST = {
  type: "boolean",
  description: "Post it to the user's connected X, LinkedIn and Bluesky accounts. Defaults to false.",
};

export const OPERATIONS: Operation[] = [
  {
    name: "whoami",
    title: "Who am I",
    description:
      "The signed-in Slopper user: profile, time zone, the open goal with progress, and streak. Call this first.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ kv, user, now }) {
      const goal = await getOpenGoal(kv, user.id, localDate(now, user.timeZone));
      const card = slopperCard(user, await listUserSlops(kv, user.id), goal, now);
      return {
        username: user.username,
        displayName: user.displayName,
        profileUrl: absoluteUrl(`/@${user.username}`),
        timeZone: user.timeZone,
        today: localDate(now, user.timeZone),
        streak: card.streak,
        totalSlops: card.totalShipped,
        goal: card.progress
          ? {
              title: card.progress.goal.title,
              target: card.progress.goal.target,
              days: card.progress.goal.days,
              startDate: card.progress.goal.startDate,
              endDate: card.progress.endDate,
              shipped: card.progress.shipped,
              currentDay: card.progress.currentDay,
              status: card.progress.status,
            }
          : null,
      };
    },
  },
  {
    name: "list_categories",
    title: "List categories and link kinds",
    description: "Valid values for a slop's category and for link kinds.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run() {
      return Promise.resolve({
        categories: CATEGORIES.map(({ id, label }) => ({ id, label })),
        linkKinds: Object.entries(LINK_KINDS).map(([kind, info]) => ({
          kind,
          label: info.label,
          beta: info.beta,
          hosts: "hosts" in info ? info.hosts : null,
        })),
      });
    },
  },
  {
    name: "set_goal",
    title: "Set a goal",
    description:
      "Start a goal such as 30 slops in 30 days. Only one goal can be open; the day boundary is midnight in the user's time zone.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "integer", minimum: 1, maximum: 1000, description: "How many slops to ship." },
        days: { type: "integer", minimum: 1, maximum: LIMITS.goalDays, description: "How many days." },
        startDate: { type: "string", format: "date", description: "YYYY-MM-DD, today or later. Defaults to today." },
        title: { type: "string", maxLength: 80, description: "Defaults to “N slops in M days”." },
      },
      required: ["target", "days"],
    },
    readOnly: false,
    async run({ kv, user, now }, input) {
      const today = localDate(now, user.timeZone);
      const parsed = validateGoal(
        {
          target: optionalNumber(input, "target"),
          days: optionalNumber(input, "days"),
          startDate: optionalString(input, "startDate"),
          title: optionalString(input, "title"),
        },
        today,
      );
      if (!parsed.ok) throw new ApiError(422, "The goal needs fixing.", parsed.errors);
      const result = await createGoal(kv, user.id, parsed.value, today);
      if (!result.ok) throw new ApiError(409, result.error);
      invalidateFeeds();
      return { goal: result.goal, profileUrl: absoluteUrl(`/@${user.username}`) };
    },
  },
  {
    name: "upload_screenshot",
    title: "Upload a screenshot",
    description:
      "Upload a PNG, JPEG, WebP or GIF (max 2 MB) as base64. Returns an id to pass in create_slop or update_slop screenshots.",
    inputSchema: {
      type: "object",
      properties: { base64: { type: "string", description: "Image bytes, base64 encoded (no data: prefix)." } },
      required: ["base64"],
    },
    readOnly: false,
    async run(context, input) {
      await rateLimit(context, "upload", 60, 3_600_000);
      const base64 = requiredString(input, "base64").replace(/^data:[^,]+,/, "");
      let bytes: Uint8Array;
      try {
        const binary = atob(base64);
        bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      } catch {
        throw new ApiError(400, "base64 is not valid base64.");
      }
      const result = await saveMedia(context.kv, context.user.id, bytes);
      if (!result.ok) throw new ApiError(400, result.error);
      return { id: result.media.id, url: absoluteUrl(mediaUrl(result.media.id)) };
    },
  },
  {
    name: "create_slop",
    title: "Launch a slop",
    description:
      "Throw a new slop at the wall. It counts towards today's goal and enters today's slop of the day race.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: LIMITS.nameLength },
        tagline: { type: "string", maxLength: LIMITS.taglineLength, description: "One line: what does it do?" },
        description: { type: "string", maxLength: LIMITS.descriptionLength, description: "Markdown." },
        category: { type: "string", enum: CATEGORIES.map((category) => category.id) },
        links: LINKS_SCHEMA,
        screenshots: {
          type: "array",
          items: { type: "string" },
          maxItems: LIMITS.screenshots,
          description: "Ids from upload_screenshot; the first is the cover.",
        },
        madeWith: { type: "array", items: { type: "string" }, maxItems: LIMITS.madeWith },
        nsfw: { type: "boolean", description: "Adult themes, gore or strong language." },
        launchNote: {
          type: "string",
          maxLength: LIMITS.updateLength,
          description: "First update; also the auto-post text.",
        },
        relaunchOf: {
          type: "string",
          description:
            "To launch an existing product again (new platform, new app, 2.0), the id or slug of an earlier launch. Features are updates, not launches.",
        },
        launchLabel: {
          type: "string",
          maxLength: LIMITS.launchLabelLength,
          description: "Required with relaunchOf: what's launching, e.g. “iOS app” or “2.0”.",
        },
        autopost: AUTOPOST,
      },
      required: ["name", "tagline", "category", "links"],
    },
    readOnly: false,
    async run(context, input) {
      const { kv, user } = context;
      const parsed = validateSlop({
        name: optionalString(input, "name"),
        tagline: optionalString(input, "tagline"),
        description: optionalString(input, "description"),
        category: optionalString(input, "category"),
        links: optionalLinks(input, "links"),
        screenshots: optionalStrings(input, "screenshots"),
        madeWith: optionalStrings(input, "madeWith"),
        nsfw: optionalBoolean(input, "nsfw"),
        launchNote: optionalString(input, "launchNote"),
      });
      if (!parsed.ok) throw new ApiError(422, "The slop needs fixing.", parsed.errors);
      let relaunch: Relaunch | null = null;
      if (optionalString(input, "relaunchOf")) {
        const of = await ownSlop(context, { slop: optionalString(input, "relaunchOf") });
        const label = optionalString(input, "launchLabel")?.trim() ?? "";
        if (!label || label.length > LIMITS.launchLabelLength) {
          throw new ApiError(
            422,
            `launchLabel is required with relaunchOf (1 to ${LIMITS.launchLabelLength} characters).`,
          );
        }
        relaunch = { of, label };
      }
      await rateLimit(context, "ship", 20, 86_400_000);
      const { launchNote, ...fields } = parsed.value;
      fields.screenshots = await ownedMediaIds(kv, user.id, fields.screenshots, relaunch?.of.screenshots);
      const { slop, update } = await createSlop(kv, user, fields, launchNote || fields.tagline, context.now, relaunch);
      invalidateFeeds();
      const autoposts = optionalBoolean(input, "autopost") ? await announce(kv, user, slop, update) : [];
      return { slop: summarizeSlop(slop, user.username), autoposts };
    },
  },
  {
    name: "update_slop",
    title: "Edit a slop",
    description: "Change a slop's details. Only the fields you pass change; the slug and launch date stay put.",
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        name: { type: "string" },
        tagline: { type: "string" },
        description: { type: "string" },
        category: { type: "string", enum: CATEGORIES.map((category) => category.id) },
        links: LINKS_SCHEMA,
        screenshots: { type: "array", items: { type: "string" } },
        madeWith: { type: "array", items: { type: "string" } },
        nsfw: { type: "boolean" },
      },
      required: ["slop"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, input);
      const parsed = validateSlop({
        name: optionalString(input, "name") ?? slop.name,
        tagline: optionalString(input, "tagline") ?? slop.tagline,
        description: optionalString(input, "description") ?? slop.description,
        category: optionalString(input, "category") ?? slop.category,
        links: optionalLinks(input, "links") ?? slop.links,
        screenshots: optionalStrings(input, "screenshots") ?? slop.screenshots,
        madeWith: optionalStrings(input, "madeWith") ?? slop.madeWith,
        nsfw: optionalBoolean(input, "nsfw") ?? slop.nsfw,
      });
      if (!parsed.ok) throw new ApiError(422, "The slop needs fixing.", parsed.errors);
      const { launchNote: _launchNote, ...fields } = parsed.value;
      fields.screenshots = await ownedMediaIds(context.kv, context.user.id, fields.screenshots, slop.screenshots);
      const updated = await editSlop(context.kv, slop.id, fields);
      invalidateFeeds();
      return { slop: summarizeSlop(updated, context.user.username) };
    },
  },
  {
    name: "post_update",
    title: "Post an update",
    description:
      "Add to a slop's updates. Kinds: update (fixes, news), feature (something new shipped), field (a real-world test: who tried it and what they said), repromote (bump it back up).",
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        kind: { type: "string", enum: [...POSTABLE_UPDATE_KINDS] },
        body: { type: "string", maxLength: LIMITS.updateLength, description: "Markdown." },
        autopost: AUTOPOST,
      },
      required: ["slop", "kind", "body"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, input);
      const kind = requiredString(input, "kind");
      if (!isPostableUpdateKind(kind))
        throw new ApiError(400, `kind must be one of ${POSTABLE_UPDATE_KINDS.join(", ")}.`);
      const body = requiredString(input, "body").trim();
      if (body.length > LIMITS.updateLength) throw new ApiError(422, `body is over ${LIMITS.updateLength} characters.`);
      await rateLimit(context, "update", 30, 86_400_000);
      const update = await addUpdate(context.kv, slop.id, context.user.id, kind, body);
      invalidateFeeds();
      const autoposts = optionalBoolean(input, "autopost")
        ? await announce(context.kv, context.user, slop, update)
        : [];
      return {
        update: {
          id: update.id,
          kind,
          url: `${absoluteUrl(slopPath(context.user.username, slop.slug))}#update-${update.id}`,
        },
        autoposts,
      };
    },
  },
  {
    name: "mark_slopcessful",
    title: "Mark a slop slopcessful",
    description:
      "Declare a breakout: real users, revenue, a viral post. The note says what happened. It shows in the hall of fame.",
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        note: { type: "string", maxLength: LIMITS.slopcessfulNoteLength, description: "e.g. “10k users in a week”" },
        autopost: AUTOPOST,
      },
      required: ["slop", "note"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, input);
      const note = requiredString(input, "note").trim().slice(0, LIMITS.slopcessfulNoteLength);
      const { slop: updated, update } = await setSlopcessful(context.kv, slop.id, note);
      invalidateFeeds();
      const autoposts =
        update && optionalBoolean(input, "autopost") ? await announce(context.kv, context.user, updated, update) : [];
      return { slop: summarizeSlop(updated, context.user.username), autoposts };
    },
  },
  {
    name: "list_my_slops",
    title: "List my slops",
    description: "Every slop the user has launched, newest first, with votes, updates and badges.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ kv, user }) {
      return { slops: (await listUserSlops(kv, user.id)).map((slop) => summarizeSlop(slop, user.username)) };
    },
  },
  {
    name: "todays_race",
    title: "Today's slop of the day race",
    description: "Today's slops ranked by votes (UTC day). The leader at midnight UTC becomes slop of the day.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ kv, now }) {
      const race = await dayRace(kv, utcDate(now), now);
      const owners = await getUsersById(
        kv,
        race.ranking.map((slop) => slop.userId),
      );
      return {
        date: race.date,
        ranking: race.ranking.slice(0, 20).flatMap((slop, index) => {
          const owner = owners.get(slop.userId);
          return owner && !slop.nsfw
            ? [{ rank: index + 1, owner: owner.username, ...summarizeSlop(slop, owner.username) }]
            : [];
        }),
      };
    },
  },
];

export function findOperation(name: string): Operation | undefined {
  return OPERATIONS.find((operation) => operation.name === name);
}

/** Runs an operation with raw, untrusted input. */
export async function runOperation(operation: Operation, context: OperationContext, input: unknown): Promise<unknown> {
  return await operation.run(context, asObject(input, "arguments"));
}
