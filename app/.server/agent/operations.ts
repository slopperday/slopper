import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import {
  CATEGORIES,
  COST_CATEGORIES,
  isPostableUpdateKind,
  LIMITS,
  LINK_KINDS,
  POSTABLE_UPDATE_KINDS,
  REVENUE_CATEGORIES,
} from "~/lib/model";
import { localDate } from "~/lib/dates";
import { slopPath } from "~/lib/display";
import { CURRENCIES } from "~/lib/money";
import { absoluteUrl } from "../config";
import { convex, convexMessage } from "../convex";
import { validateGoal, validateSlop } from "../forms";
import { uploadImage } from "../media";
import { checkedContent, checkSlop } from "../moderation";
import { announce } from "../social/announce";
import type { User } from "../session";
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

function summarizeSlop(slop: Doc<"slops">, username: string) {
  return {
    id: slop._id,
    number: slop.number,
    slug: slop.slug,
    productId: slop.productId ?? slop._id,
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
    backers: slop.backers,
    pledgedUsdCents: slop.pledged,
    slopOfTheDay: slop.slopOfTheDay,
    slopcessful: slop.slopcessfulAt
      ? { at: new Date(slop.slopcessfulAt).toISOString(), note: slop.slopcessfulNote }
      : null,
  };
}

/** Finds one of the caller's slops by id or slug. */
async function ownSlop(context: OperationContext, ref: string): Promise<Doc<"slops">> {
  const slop = await convex.query(api.slops.findForServer, { userId: context.user._id, ref: ref.trim() });
  if (!slop) throw new ApiError(404, `No slop of yours matches “${ref}”.`);
  return slop;
}

async function slopById(slopId: Doc<"slops">["_id"]): Promise<Doc<"slops">> {
  const slop = await convex.query(api.slops.getForServer, { slopId });
  if (!slop) throw new ApiError(404, "Slop not found.");
  return slop;
}

const SLOP_REF = { type: "string", description: "The slop's id or slug (from list_my_slops or create_slop)." };

const LINKS_SCHEMA = {
  type: "array",
  description: "Where people can try it. At least one. Store links must use their store's domain.",
  items: {
    type: "object",
    properties: { kind: { type: "string", enum: Object.keys(LINK_KINDS) }, url: { type: "string" } },
    required: ["kind", "url"],
  },
  maxItems: LIMITS.links,
};

const AUTOPOST = {
  type: "boolean",
  description:
    "Post it to the user's connected X, LinkedIn and Bluesky accounts. Defaults to false. Held (with the reason) unless the slop passed the content check and nobody has flagged it.",
};

export const OPERATIONS: Operation[] = [
  {
    name: "whoami",
    title: "Who am I",
    description:
      "The signed-in Slopper user: profile, time zone, the open goal with progress, and streak. Call this first.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ user, now }) {
      const profile = await convex.query(api.users.profile, { username: user.username, asUser: user._id });
      const progress = profile?.progress ?? null;
      return {
        username: user.username,
        displayName: user.displayName,
        profileUrl: absoluteUrl(`/@${user.username}`),
        timeZone: user.timeZone,
        today: localDate(now, user.timeZone),
        streak: profile?.streak ?? 0,
        totalSlops: profile?.totalShipped ?? 0,
        goal: progress
          ? {
              title: progress.goal.title,
              target: progress.goal.target,
              days: progress.goal.days,
              startDate: progress.goal.startDate,
              endDate: progress.endDate,
              shipped: progress.shipped,
              currentDay: progress.currentDay,
              status: progress.status,
            }
          : null,
      };
    },
  },
  {
    name: "list_categories",
    title: "List categories and link kinds",
    description: "Valid values for a slop's category, link kinds, currencies and money categories.",
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
        currencies: CURRENCIES,
        costCategories: COST_CATEGORIES,
        revenueCategories: REVENUE_CATEGORIES,
      });
    },
  },
  {
    name: "set_goal",
    title: "Set a goal",
    description:
      "Start a goal such as 30 slops in 30 days. Only one goal can be open; days end at midnight in the user's time zone.",
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
    async run({ user, now }, input) {
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
      const result = await convex.mutation(api.goals.create, { userId: user._id, today, ...parsed.value });
      if (!result.ok) throw new ApiError(409, result.error);
      const { title, target, days, startDate, endDate } = result.goal;
      return { goal: { title, target, days, startDate, endDate }, profileUrl: absoluteUrl(`/@${user.username}`) };
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
    async run({ user }, input) {
      const base64 = requiredString(input, "base64").replace(/^data:[^,]+,/, "");
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      } catch {
        throw new ApiError(400, "base64 is not valid base64.");
      }
      const result = await uploadImage(user._id, bytes);
      if (!result.ok) throw new ApiError(400, result.error);
      return { id: result.id, url: result.url };
    },
  },
  {
    name: "create_slop",
    title: "Launch a slop",
    description:
      "Throw a new slop at the wall. It counts towards today's goal and enters today's slop of the day race. To launch an existing product again (new platform, new app, 2.0), pass relaunchOf and launchLabel.",
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
        launchNote: {
          type: "string",
          maxLength: LIMITS.updateLength,
          description: "First update; also the auto-post text.",
        },
        relaunchOf: {
          type: "string",
          description:
            "To launch an existing product again, the id or slug of an earlier launch. Features are updates, not launches.",
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
      const { user, now } = context;
      const parsed = validateSlop({
        name: optionalString(input, "name"),
        tagline: optionalString(input, "tagline"),
        description: optionalString(input, "description"),
        category: optionalString(input, "category"),
        links: optionalLinks(input, "links"),
        screenshots: optionalStrings(input, "screenshots"),
        madeWith: optionalStrings(input, "madeWith"),
        launchNote: optionalString(input, "launchNote"),
      });
      if (!parsed.ok) throw new ApiError(422, "The slop needs fixing.", parsed.errors);
      const relaunchRef = optionalString(input, "relaunchOf");
      const source = relaunchRef ? await ownSlop(context, relaunchRef) : null;
      const label = optionalString(input, "launchLabel")?.trim() ?? "";
      if (source && (!label || label.length > LIMITS.launchLabelLength)) {
        throw new ApiError(
          422,
          `launchLabel is required with relaunchOf (1 to ${LIMITS.launchLabelLength} characters).`,
        );
      }
      const { launchNote, ...fields } = parsed.value;
      const created = await convex.mutation(api.slops.create, {
        userId: user._id,
        input: fields,
        launchNote: launchNote || fields.tagline,
        today: localDate(now, user.timeZone),
        ...(source ? { relaunchOf: source._id, launchLabel: label } : {}),
      });
      const check = await checkSlop(created.slopId, launchNote);
      const autopost =
        optionalBoolean(input, "autopost") && check?.verdict !== "blocked"
          ? await announce(user, created.slopId, created.updateId)
          : null;
      return {
        slop: summarizeSlop(await slopById(created.slopId), user.username),
        contentCheck: check?.verdict ?? "unchecked",
        autopost,
      };
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
      },
      required: ["slop"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const parsed = validateSlop({
        name: optionalString(input, "name") ?? slop.name,
        tagline: optionalString(input, "tagline") ?? slop.tagline,
        description: optionalString(input, "description") ?? slop.description,
        category: optionalString(input, "category") ?? slop.category,
        links: optionalLinks(input, "links") ?? slop.links,
        screenshots: optionalStrings(input, "screenshots") ?? slop.screenshots,
        madeWith: optionalStrings(input, "madeWith") ?? slop.madeWith,
      });
      if (!parsed.ok) throw new ApiError(422, "The slop needs fixing.", parsed.errors);
      const { launchNote: _launchNote, ...fields } = parsed.value;
      await convex.mutation(api.slops.edit, { userId: context.user._id, slopId: slop._id, input: fields });
      const saved = await slopById(slop._id);
      const check = checkedContent(saved) !== checkedContent(slop) ? await checkSlop(slop._id) : null;
      return {
        slop: summarizeSlop(await slopById(slop._id), context.user.username),
        ...(check ? { contentCheck: check.verdict } : {}),
      };
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
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const kind = requiredString(input, "kind");
      if (!isPostableUpdateKind(kind))
        throw new ApiError(400, `kind must be one of ${POSTABLE_UPDATE_KINDS.join(", ")}.`);
      const body = requiredString(input, "body").trim();
      if (body.length > LIMITS.updateLength) throw new ApiError(422, `body is over ${LIMITS.updateLength} characters.`);
      const updateId = await convex.mutation(api.activity.addUpdate, {
        userId: context.user._id,
        slopId: slop._id,
        kind,
        body,
      });
      const autopost = optionalBoolean(input, "autopost") ? await announce(context.user, slop._id, updateId) : null;
      return {
        update: {
          id: updateId,
          kind,
          url: `${absoluteUrl(slopPath(context.user.username, slop.slug))}#update-${updateId}`,
        },
        autopost,
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
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const note = requiredString(input, "note").trim();
      const updateId = await convex.mutation(api.slops.setSlopcessful, {
        userId: context.user._id,
        slopId: slop._id,
        note,
      });
      const autopost =
        updateId && optionalBoolean(input, "autopost") ? await announce(context.user, slop._id, updateId) : null;
      return { slop: summarizeSlop(await slopById(slop._id), context.user.username), autopost };
    },
  },
  {
    name: "log_money",
    title: "Log a cost or revenue",
    description:
      "Record money for a product (shared by all its launches): a cost like a domain, hosting or AI tokens, or revenue like sales or subscriptions.",
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        kind: { type: "string", enum: ["cost", "revenue"] },
        amount: { type: "number", exclusiveMinimum: 0, description: "In major units, e.g. 12.99." },
        currency: { type: "string", enum: [...CURRENCIES], description: "Defaults to USD." },
        category: {
          type: "string",
          description: `Cost: ${COST_CATEGORIES.join(", ")}. Revenue: ${REVENUE_CATEGORIES.join(", ")}.`,
        },
        note: { type: "string", maxLength: LIMITS.ledgerNoteLength },
        date: { type: "string", format: "date", description: "YYYY-MM-DD. Defaults to today." },
      },
      required: ["slop", "kind", "amount"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const kind = requiredString(input, "kind");
      if (kind !== "cost" && kind !== "revenue") throw new ApiError(400, "kind must be cost or revenue.");
      const major = optionalNumber(input, "amount") ?? 0;
      const amount = Math.round(major * 100);
      const currency = optionalString(input, "currency") ?? "USD";
      const categories: readonly string[] = kind === "cost" ? COST_CATEGORIES : REVENUE_CATEGORIES;
      const category = optionalString(input, "category") ?? "other";
      const note = (optionalString(input, "note") ?? "").trim();
      const date = optionalString(input, "date") ?? localDate(context.now, context.user.timeZone);
      if (amount <= 0 || amount > 1e12) throw new ApiError(422, "amount must be above zero.");
      if (!(CURRENCIES as readonly string[]).includes(currency))
        throw new ApiError(422, `currency is one of ${CURRENCIES.join(", ")}.`);
      if (!categories.includes(category)) throw new ApiError(422, `category is one of ${categories.join(", ")}.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(422, "date must be YYYY-MM-DD.");
      if (note.length > LIMITS.ledgerNoteLength)
        throw new ApiError(422, `note is over ${LIMITS.ledgerNoteLength} characters.`);
      const entryId = await convex.mutation(api.money.add, {
        userId: context.user._id,
        slopId: slop._id,
        kind,
        amount,
        currency,
        category,
        note,
        date,
      });
      return { entry: { id: entryId, kind, amount: major, currency, category, note, date } };
    },
  },
  {
    name: "list_my_slops",
    title: "List my slops",
    description: "Every slop the user has launched, newest first, with votes, updates, pledges and badges.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ user }) {
      const slops = await convex.query(api.slops.listForServer, { userId: user._id });
      return { slops: slops.map((slop) => summarizeSlop(slop, user.username)) };
    },
  },
  {
    name: "todays_race",
    title: "Today's slop of the day race",
    description: "Today's slops ranked by votes (UTC day). The leader at midnight UTC becomes slop of the day.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ now }) {
      const race = await convex.query(api.race.day, { date: now.toISOString().slice(0, 10), limit: 20 });
      return {
        date: race.date,
        ranking: race.items.map((item, index) => ({
          rank: index + 1,
          owner: item.owner.username,
          name: item.slop.name,
          launchLabel: item.slop.launchLabel,
          tagline: item.slop.tagline,
          upvotes: item.slop.upvotes,
          url: absoluteUrl(slopPath(item.owner.username, item.slop.slug)),
        })),
      };
    },
  },
];

export function findOperation(name: string): Operation | undefined {
  return OPERATIONS.find((operation) => operation.name === name);
}

/** Runs an operation with raw, untrusted input. Business-rule errors become ApiErrors. */
export async function runOperation(operation: Operation, context: OperationContext, input: unknown): Promise<unknown> {
  try {
    return await operation.run(context, asObject(input, "arguments"));
  } catch (error) {
    const message = convexMessage(error);
    if (message) throw new ApiError(409, message);
    throw error;
  }
}
