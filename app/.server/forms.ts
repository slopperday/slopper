import {
  type CategoryId,
  findCategory,
  isFieldOutcome,
  isLinkKind,
  isPostableUpdateKind,
  LIMITS,
  LINK_KINDS,
  POSTABLE_UPDATE_KINDS,
  type PostableUpdateKind,
  type SlopFeature,
  type SlopLink,
  type UpdateDetails,
} from "~/lib/model";
import { type DemoVideo, parseVideoUrl, videoPageUrl } from "~/lib/video";
/** Everything a person types when shipping or editing a slop. */
export interface SlopInput {
  name: string;
  tagline: string;
  description: string;
  category: CategoryId;
  links: SlopLink[];
  /** Media ids; Convex re-checks each one belongs to the uploader. */
  screenshots: string[];
  madeWith: string[];
  demo: DemoVideo | null;
  features: SlopFeature[];
  audience: string;
}
import { addDays, isIsoDate } from "~/lib/dates";
import { findGoalPace, paceTarget } from "~/lib/goal";

/** Form parsing and validation, shared by create and edit flows. */

export type FieldErrors = Record<string, string>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function all(form: FormData, name: string): string[] {
  return form.getAll(name).map((value) => (typeof value === "string" ? value.trim() : ""));
}

/** Normalises an http(s) URL, or returns null when it is not one. */
export function parseWebUrl(value: string): URL | null {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** One typed link: a known kind, a web address, and the right host for store links. */
function parseLink(kind: string, raw: string): { link: SlopLink } | { error: string } {
  if (!isLinkKind(kind)) return { error: "Unknown link type." };
  const url = parseWebUrl(raw);
  if (!url) return { error: `“${raw}” is not a web address.` };
  const info = LINK_KINDS[kind];
  if ("hosts" in info) {
    const hosts: readonly string[] = info.hosts;
    if (!hosts.includes(url.hostname)) return { error: `${info.label} links live on ${hosts.join(" or ")}.` };
  }
  return { link: { kind, url: url.href } };
}

export function parseLinks(kinds: string[], urls: string[]): { links: SlopLink[]; error: string | null } {
  const links: SlopLink[] = [];
  for (let index = 0; index < urls.length; index++) {
    const raw = urls[index];
    if (!raw) continue;
    const parsed = parseLink(kinds[index] ?? "website", raw);
    if ("error" in parsed) return { links, error: parsed.error };
    links.push(parsed.link);
  }
  if (links.length === 0) {
    return { links, error: "Add at least one link so people can try it." };
  }
  if (links.length > LIMITS.links) {
    return { links, error: `Up to ${LIMITS.links} links.` };
  }
  return { links, error: null };
}

/** Convex document ids are short lowercase base32 strings. */
const MEDIA_ID = /^[a-z0-9]{16,64}$/;

export interface SlopForm extends SlopInput {
  launchNote: string;
}

/** A slop as typed into the form or sent by an agent, before validation. */
export interface SlopDraft {
  name?: string;
  tagline?: string;
  description?: string;
  category?: string;
  links?: readonly { kind?: string; url?: string }[];
  screenshots?: readonly string[];
  madeWith?: readonly string[];
  /** A YouTube, Loom or Vimeo link; empty for none. */
  demo?: string;
  features?: readonly { title?: string; body?: string }[];
  audience?: string;
  launchNote?: string;
}

export function slopDraftFromForm(form: FormData): SlopDraft {
  const kinds = all(form, "linkKind");
  return {
    name: text(form, "name"),
    tagline: text(form, "tagline"),
    description: text(form, "description"),
    category: text(form, "category"),
    links: all(form, "linkUrl").map((url, index) => ({ kind: kinds[index] ?? "website", url })),
    screenshots: all(form, "screenshot"),
    madeWith: text(form, "madeWith").split(","),
    demo: text(form, "demo"),
    features: pairs(all(form, "featureTitle"), all(form, "featureBody")),
    audience: text(form, "audience"),
    launchNote: text(form, "launchNote"),
  };
}

function pairs(titles: readonly string[], bodies: readonly string[]): { title: string; body: string }[] {
  return titles.map((title, index) => ({ title, body: bodies[index] ?? "" }));
}

/** Rows with nothing typed are dropped; a line with no title is an error. */
export function parseFeatures(rows: readonly { title?: string; body?: string }[]): {
  features: SlopFeature[];
  error: string | null;
} {
  const features = rows
    .map((row) => ({ title: row.title?.trim() ?? "", body: row.body?.trim() ?? "" }))
    .filter((row) => row.title || row.body);
  if (features.length > LIMITS.features) return { features, error: `Up to ${LIMITS.features} features.` };
  if (features.some((feature) => !feature.title)) return { features, error: "Give each feature a short title." };
  if (features.some((feature) => feature.title.length > LIMITS.featureTitleLength)) {
    return { features, error: `Keep feature titles under ${LIMITS.featureTitleLength} characters.` };
  }
  if (features.some((feature) => feature.body.length > LIMITS.featureBodyLength)) {
    return { features, error: `Keep each feature to one line, under ${LIMITS.featureBodyLength} characters.` };
  }
  return { features, error: null };
}

/** One validation path for the web form, the REST API and MCP. */
export function validateSlop(draft: SlopDraft): Parsed<SlopForm> {
  const errors: FieldErrors = {};
  const name = draft.name?.trim() ?? "";
  const tagline = draft.tagline?.trim() ?? "";
  const description = draft.description?.trim() ?? "";
  const category = findCategory(draft.category?.trim() ?? "");
  const launchNote = draft.launchNote?.trim() ?? "";
  const audience = draft.audience?.trim() ?? "";
  const demoUrl = draft.demo?.trim() ?? "";
  const demo = demoUrl ? parseVideoUrl(demoUrl) : null;

  if (!name) errors.name = "Give it a name.";
  else if (name.length > LIMITS.nameLength) errors.name = `Keep it under ${LIMITS.nameLength} characters.`;
  if (!tagline) errors.tagline = "One line on what it does.";
  else if (tagline.length > LIMITS.taglineLength) errors.tagline = `Keep it under ${LIMITS.taglineLength} characters.`;
  if (description.length > LIMITS.descriptionLength) {
    errors.description = `Keep it under ${LIMITS.descriptionLength} characters.`;
  }
  if (!category) errors.category = "Pick a category.";
  if (launchNote.length > LIMITS.updateLength) errors.launchNote = `Keep it under ${LIMITS.updateLength} characters.`;
  if (audience.length > LIMITS.audienceLength) errors.audience = `Keep it under ${LIMITS.audienceLength} characters.`;
  if (demoUrl && !demo) errors.demo = "Link a video on YouTube, Loom or Vimeo.";
  const { features, error: featureError } = parseFeatures(draft.features ?? []);
  if (featureError) errors.features = featureError;

  const rawLinks = draft.links ?? [];
  const { links, error: linkError } = parseLinks(
    rawLinks.map((link) => link.kind?.trim() || "website"),
    rawLinks.map((link) => link.url?.trim() ?? ""),
  );
  if (linkError) errors.links = linkError;

  const screenshots = [...new Set((draft.screenshots ?? []).map((id) => id.trim()))].filter((id) => MEDIA_ID.test(id));
  if (screenshots.length > LIMITS.screenshots) errors.screenshots = `Up to ${LIMITS.screenshots} screenshots.`;

  const madeWith = [...new Set((draft.madeWith ?? []).map((tag) => tag.trim().slice(0, 24)).filter(Boolean))].slice(
    0,
    LIMITS.madeWith,
  );

  if (Object.keys(errors).length > 0 || !category) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      tagline,
      description,
      category: category.id,
      links,
      screenshots,
      madeWith,
      demo,
      features,
      audience,
      launchNote,
    },
  };
}

export function parseSlopForm(form: FormData): Parsed<SlopForm> {
  return validateSlop(slopDraftFromForm(form));
}

/** An update as typed into the composer or sent by an agent, before validation. */
export interface UpdateDraft {
  kind?: string;
  body?: string;
  version?: string;
  images?: readonly string[];
  links?: readonly { kind?: string; url?: string; preview?: boolean }[];
  featureName?: string;
  who?: string;
  outcome?: string;
}

export interface UpdateLinkForm extends SlopLink {
  /** Read the page and show a card for it. Off unless the maker asks. */
  preview: boolean;
}

export interface UpdateForm {
  kind: PostableUpdateKind;
  body: string;
  version: string | null;
  /** Media ids; Convex re-checks each one belongs to the uploader. */
  images: string[];
  links: UpdateLinkForm[];
  details: UpdateDetails | null;
}

export function updateDraftFromForm(form: FormData): UpdateDraft {
  const kinds = all(form, "linkKind");
  const previews = all(form, "linkPreview");
  return {
    kind: text(form, "kind"),
    body: text(form, "body"),
    version: text(form, "version"),
    images: all(form, "image"),
    links: all(form, "linkUrl").map((url, index) => ({
      kind: kinds[index] ?? "website",
      url,
      preview: previews[index] === "on",
    })),
    featureName: text(form, "featureName"),
    who: text(form, "who"),
    outcome: text(form, "outcome"),
  };
}

/** What a feature or field test adds: only those kinds take these fields. */
function updateDetails(kind: string, draft: UpdateDraft, errors: FieldErrors): UpdateDetails | null {
  const name = draft.featureName?.trim() ?? "";
  const who = draft.who?.trim() ?? "";
  const outcome = draft.outcome?.trim() ?? "";
  let details: UpdateDetails | null = null;
  if (name) {
    if (kind !== "feature") errors.featureName = "A feature name is for feature updates.";
    else if (name.length > LIMITS.featureNameLength) {
      errors.featureName = `Keep the feature name under ${LIMITS.featureNameLength} characters.`;
    } else details = { kind: "feature", name };
  }
  if (who || outcome) {
    if (kind !== "field") errors.outcome = "Who tried it and how it went are for field tests.";
    else if (!isFieldOutcome(outcome)) errors.outcome = "Say how it went: worked, mixed or broke.";
    else if (who.length > LIMITS.fieldWhoLength)
      errors.who = `Keep who tried it under ${LIMITS.fieldWhoLength} characters.`;
    else details = { kind: "field", outcome, who: who || null };
  }
  return details;
}

/** One validation path for the update composer, the REST API and MCP. */
export function validateUpdate(draft: UpdateDraft): Parsed<UpdateForm> {
  const errors: FieldErrors = {};
  const kind = draft.kind?.trim() || "update";
  const body = draft.body?.trim() ?? "";
  const version = draft.version?.trim().replace(/\s+/g, " ") ?? "";

  if (!isPostableUpdateKind(kind)) errors.kind = `Pick one of ${POSTABLE_UPDATE_KINDS.join(", ")}.`;
  if (!body) errors.body = "Say what happened.";
  else if (body.length > LIMITS.updateLength) errors.body = `Keep it under ${LIMITS.updateLength} characters.`;
  if (version.length > LIMITS.versionLength) {
    errors.version = `Keep the version under ${LIMITS.versionLength} characters.`;
  }
  const details = updateDetails(kind, draft, errors);

  const links: UpdateLinkForm[] = [];
  for (const raw of draft.links ?? []) {
    const url = raw.url?.trim();
    if (!url) continue;
    const parsed = parseLink(raw.kind?.trim() || "website", url);
    if ("error" in parsed) {
      errors.links = parsed.error;
      break;
    }
    if (links.some((link) => link.url === parsed.link.url)) {
      errors.links = "Add each link once.";
      break;
    }
    links.push({ ...parsed.link, preview: raw.preview === true });
  }
  if (links.length > LIMITS.updateLinks) errors.links = `Up to ${LIMITS.updateLinks} links.`;

  const images = [...new Set((draft.images ?? []).map((id) => id.trim()))].filter((id) => MEDIA_ID.test(id));
  if (images.length > LIMITS.updateImages) errors.images = `Up to ${LIMITS.updateImages} images.`;

  if (Object.keys(errors).length > 0 || !isPostableUpdateKind(kind)) return { ok: false, errors };
  return { ok: true, value: { kind, body, version: version || null, images, links, details } };
}

export interface GoalForm {
  title: string;
  target: number;
  days: number;
  startDate: string;
}

export interface GoalDraft {
  title?: string;
  target?: number;
  days?: number;
  startDate?: string;
}

export function validateGoal(draft: GoalDraft, today: string): Parsed<GoalForm> {
  const errors: FieldErrors = {};
  const days = draft.days ?? Number.NaN;
  const target = draft.target ?? Number.NaN;
  const startDate = draft.startDate?.trim() || today;
  const title = draft.title?.trim() || `${target} slops in ${days} days`;

  if (!Number.isInteger(days) || days < 1 || days > LIMITS.goalDays) {
    errors.days = `Pick 1 to ${LIMITS.goalDays} days.`;
  }
  if (!Number.isInteger(target) || target < 1 || target > 1000) {
    errors.target = "Pick how many slops you will ship.";
  }
  if (!isIsoDate(startDate)) errors.startDate = "Pick a start date.";
  else if (startDate < today) errors.startDate = "Start today or later.";
  else if (startDate > addDays(today, 30)) errors.startDate = "Start within the next 30 days.";
  if (title.length > 80) errors.title = "Keep it under 80 characters.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { title, target, days, startDate } };
}

export function parseGoalForm(form: FormData, today: string): Parsed<GoalForm> {
  // Typed numbers win over the buttons: other days over the day choices, exact slops over the pace.
  const days = Number(text(form, "customDays") || text(form, "days"));
  const pace = findGoalPace(text(form, "pace"));
  const exact = text(form, "target");
  const target = exact ? Number(exact) : pace && Number.isInteger(days) ? paceTarget(pace, days) : Number.NaN;
  return validateGoal({ title: text(form, "title"), target, days, startDate: text(form, "startDate") }, today);
}

export function formText(form: FormData, name: string): string {
  return text(form, name);
}

/** Echoes what was typed back into the form after a validation error. */
export function slopFormValues(form: FormData) {
  const draft = slopDraftFromForm(form);
  return {
    name: draft.name ?? "",
    tagline: draft.tagline ?? "",
    description: draft.description ?? "",
    category: draft.category ?? "",
    links: (draft.links ?? []).map((link): SlopLink => {
      const kind = link.kind ?? "";
      return { kind: isLinkKind(kind) ? kind : "website", url: link.url ?? "" };
    }),
    screenshots: (draft.screenshots ?? []).filter((id) => MEDIA_ID.test(id)),
    madeWith: (draft.madeWith ?? []).map((tag) => tag.trim()).filter(Boolean),
    demo: draft.demo ?? "",
    features: (draft.features ?? []).map((row) => ({ title: row.title ?? "", body: row.body ?? "" })),
    audience: draft.audience ?? "",
    launchNote: draft.launchNote ?? "",
  };
}

/** A stored slop as the form shows it. */
export function slopValues(slop: {
  name: string;
  tagline: string;
  description: string;
  category: string;
  links: SlopLink[];
  madeWith: string[];
  demo?: DemoVideo | null;
  features?: SlopFeature[];
  audience?: string;
}) {
  return {
    name: slop.name,
    tagline: slop.tagline,
    description: slop.description,
    category: slop.category,
    links: slop.links,
    madeWith: slop.madeWith,
    demo: slop.demo ? videoPageUrl(slop.demo) : "",
    features: slop.features ?? [],
    audience: slop.audience ?? "",
  };
}
