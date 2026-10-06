import { findCategory, isLinkKind, LIMITS, LINK_KINDS, type SlopLink } from "~/lib/model";
import type { SlopInput } from "./db/slops";
import { addDays, isIsoDate } from "~/lib/dates";

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

export function parseLinks(kinds: string[], urls: string[]): { links: SlopLink[]; error: string | null } {
  const links: SlopLink[] = [];
  for (let index = 0; index < urls.length; index++) {
    const raw = urls[index];
    if (!raw) continue;
    const kind = kinds[index] ?? "website";
    if (!isLinkKind(kind)) return { links, error: "Unknown link type." };
    const url = parseWebUrl(raw);
    if (!url) return { links, error: `“${raw}” is not a web address.` };
    const info = LINK_KINDS[kind];
    if ("hosts" in info) {
      const hosts: readonly string[] = info.hosts;
      if (!hosts.includes(url.hostname)) {
        return {
          links,
          error: `${info.label} links live on ${hosts.join(" or ")}.`,
        };
      }
    }
    links.push({ kind, url: url.href });
  }
  if (links.length === 0) {
    return { links, error: "Add at least one link so people can try it." };
  }
  if (links.length > LIMITS.links) {
    return { links, error: `Up to ${LIMITS.links} links.` };
  }
  return { links, error: null };
}

const MEDIA_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export interface SlopForm extends SlopInput {
  launchNote: string;
}

/** A slop as typed into the form or sent by an agent, before validation. */
export interface SlopDraft {
  name?: string;
  tagline?: string;
  description?: string;
  category?: string;
  nsfw?: boolean;
  links?: readonly { kind?: string; url?: string }[];
  screenshots?: readonly string[];
  madeWith?: readonly string[];
  launchNote?: string;
}

export function slopDraftFromForm(form: FormData): SlopDraft {
  const kinds = all(form, "linkKind");
  return {
    name: text(form, "name"),
    tagline: text(form, "tagline"),
    description: text(form, "description"),
    category: text(form, "category"),
    nsfw: form.get("nsfw") === "on",
    links: all(form, "linkUrl").map((url, index) => ({ kind: kinds[index] ?? "website", url })),
    screenshots: all(form, "screenshot"),
    madeWith: text(form, "madeWith").split(","),
    launchNote: text(form, "launchNote"),
  };
}

/** One validation path for the web form, the REST API and MCP. */
export function validateSlop(draft: SlopDraft): Parsed<SlopForm> {
  const errors: FieldErrors = {};
  const name = draft.name?.trim() ?? "";
  const tagline = draft.tagline?.trim() ?? "";
  const description = draft.description?.trim() ?? "";
  const category = findCategory(draft.category?.trim() ?? "");
  const launchNote = draft.launchNote?.trim() ?? "";

  if (!name) errors.name = "Give it a name.";
  else if (name.length > LIMITS.nameLength) errors.name = `Keep it under ${LIMITS.nameLength} characters.`;
  if (!tagline) errors.tagline = "One line on what it does.";
  else if (tagline.length > LIMITS.taglineLength) errors.tagline = `Keep it under ${LIMITS.taglineLength} characters.`;
  if (description.length > LIMITS.descriptionLength) {
    errors.description = `Keep it under ${LIMITS.descriptionLength} characters.`;
  }
  if (!category) errors.category = "Pick a category.";
  if (launchNote.length > LIMITS.updateLength) errors.launchNote = `Keep it under ${LIMITS.updateLength} characters.`;

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
      nsfw: draft.nsfw === true,
      links,
      screenshots,
      madeWith,
      launchNote,
    },
  };
}

export function parseSlopForm(form: FormData): Parsed<SlopForm> {
  return validateSlop(slopDraftFromForm(form));
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
  // Typed numbers win over the chosen preset ("30/30").
  const [presetTarget = "", presetDays = ""] = text(form, "preset").split("/");
  return validateGoal(
    {
      title: text(form, "title"),
      target: Number(text(form, "target") || presetTarget),
      days: Number(text(form, "days") || presetDays),
      startDate: text(form, "startDate"),
    },
    today,
  );
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
    nsfw: draft.nsfw === true,
    links: (draft.links ?? []).map((link): SlopLink => {
      const kind = link.kind ?? "";
      return { kind: isLinkKind(kind) ? kind : "website", url: link.url ?? "" };
    }),
    screenshots: (draft.screenshots ?? []).filter((id) => MEDIA_ID.test(id)),
    madeWith: (draft.madeWith ?? []).map((tag) => tag.trim()).filter(Boolean),
    launchNote: draft.launchNote ?? "",
  };
}
