import { HACKER_HOUSE, hackerHouseActive } from "./hackerHouse";
import { LIMITS } from "./model";

/**
 * "Made with" tags: what a slop was built with. Each tag has a kind (the
 * model that wrote it, the harness that ran the model, the framework, where
 * it runs) so we can see how slop gets made. Kinds and the tags we know are
 * hardcoded here; anything else people type becomes a tag of kind "other"
 * and shows up in suggestions once it's used.
 *
 * To add a kind, add it to TAG_KINDS (and a colour in app.css, `.tag-kind-…`).
 * To add a tag, add it to KNOWN_TAGS. Names are what's stored on slops, so
 * renaming one means keeping the old name as an alias.
 */
export const TAG_KINDS = [
  { id: "model", label: "Model", plural: "Models" },
  { id: "harness", label: "Harness", plural: "Harnesses" },
  { id: "framework", label: "Framework", plural: "Frameworks" },
  { id: "platform", label: "Platform", plural: "Platforms" },
  { id: "other", label: "Other", plural: "Other" },
] as const;

export type TagKind = (typeof TAG_KINDS)[number]["id"];

export interface KnownTag {
  name: string;
  kind: TagKind;
  /** Other ways people write it; typed in any case, they become `name`. */
  aliases?: readonly string[];
}

/** A tag as the picker offers it: known ones, and what people have used, most used first. */
export interface TagOption {
  name: string;
  kind: TagKind;
  uses: number;
  aliases: readonly string[];
}

const model = (name: string, ...aliases: string[]): KnownTag => ({ name, kind: "model", aliases });
const harness = (name: string, ...aliases: string[]): KnownTag => ({ name, kind: "harness", aliases });
const framework = (name: string, ...aliases: string[]): KnownTag => ({ name, kind: "framework", aliases });
const platform = (name: string, ...aliases: string[]): KnownTag => ({ name, kind: "platform", aliases });

export const KNOWN_TAGS: readonly KnownTag[] = [
  model("Opus 5.5", "Claude Opus 5.5", "opus-5.5", "claude-opus-5-5"),
  model("Sonnet 5.5", "Claude Sonnet 5.5", "sonnet-5.5", "claude-sonnet-5-5"),
  model("Haiku 5.5", "Claude Haiku 5.5", "haiku-5.5", "claude-haiku-5-5"),
  model("Fable 5.1", "Claude Fable 5.1", "fable-5.1", "claude-fable-5-1"),
  model("Opus 5", "Claude Opus 5", "claude-opus-5"),
  model("Opus 4.8", "Claude Opus 4.8", "claude-opus-4-8"),
  model("Opus 4.5", "Claude Opus 4.5", "claude-opus-4-5"),
  model("Sonnet 4.5", "Claude Sonnet 4.5", "claude-sonnet-4-5"),
  model("GPT-5", "gpt5", "gpt 5"),
  model("GPT-5 Codex", "gpt-5-codex"),
  model("Gemini 3 Pro", "gemini-3-pro"),
  model("Gemini 3.1 Flash Lite", "gemini-3.1-flash-lite"),
  model("Gemini 2.5 Pro", "gemini-2.5-pro"),
  model("Grok 4", "grok-4"),
  model("DeepSeek V4.1", "deepseek-v4.1", "DeepSeek"),
  model("Kimi K2", "kimi-k2"),
  model("Qwen3 Coder", "qwen3-coder", "Qwen"),
  model("GLM 4.6", "glm-4.6"),
  harness("Claude Code", "claude-code"),
  harness("Codex", "Codex CLI", "OpenAI Codex"),
  harness("Cursor"),
  harness("GitHub Copilot", "Copilot"),
  harness("Windsurf"),
  harness("Gemini CLI", "gemini-cli"),
  harness("Cline"),
  harness("Roo Code"),
  harness("Aider"),
  harness("OpenCode"),
  harness("Amp"),
  harness("Zed"),
  harness("Kiro"),
  harness("Goose"),
  harness("Devin"),
  harness("Jules"),
  harness("Lovable"),
  harness("Bolt", "bolt.new"),
  harness("v0"),
  harness("Replit", "Replit Agent"),
  framework("React"),
  framework("Next.js", "nextjs", "next"),
  framework("React Router", "Remix"),
  framework("Vite"),
  framework("Svelte", "SvelteKit"),
  framework("Vue", "Nuxt"),
  framework("Astro"),
  framework("Tailwind", "Tailwind CSS", "tailwindcss"),
  framework("Flutter"),
  framework("React Native"),
  framework("Expo"),
  framework("SwiftUI", "Swift"),
  framework("Jetpack Compose", "Kotlin"),
  framework("Rails", "Ruby on Rails"),
  framework("Django"),
  framework("FastAPI"),
  framework("Godot"),
  framework("Unity"),
  framework("Three.js", "threejs"),
  platform("Convex"),
  platform("Supabase"),
  platform("Firebase"),
  platform("Vercel"),
  platform("Netlify"),
  platform("Cloudflare", "Cloudflare Workers"),
  platform("Deno", "Deno Deploy"),
  platform("Fly.io", "fly"),
  platform("Railway"),
  platform("Stripe"),
  platform("Solana"),
  { name: HACKER_HOUSE.tag, kind: "other", aliases: HACKER_HOUSE.aliases },
  platform("Ethereum"),
  platform("Chrome extension"),
];

/** The key a tag is counted and matched by: case and spacing don't make a new tag. */
export function tagKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const BY_KEY = new Map<string, KnownTag>();
for (const tag of KNOWN_TAGS) {
  for (const name of [tag.name, ...(tag.aliases ?? [])]) BY_KEY.set(tagKey(name), tag);
}

/** The known tag `name` is, or one of its aliases is. */
export function knownTag(name: string): KnownTag | undefined {
  return BY_KEY.get(tagKey(name));
}

export function tagKind(name: string): TagKind {
  return knownTag(name)?.kind ?? "other";
}

/**
 * Tags as typed or sent by an agent, cleaned: trimmed, known ones spelled
 * the way we spell them, duplicates (in any case) dropped, up to the limit.
 * Commas split one string into several, so "Claude Code, Vite" still works.
 */
export function cleanTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const piece of raw.flatMap((value) => value.split(","))) {
    const trimmed = piece.trim().replace(/\s+/g, " ").slice(0, LIMITS.madeWithLength);
    if (!trimmed) continue;
    const name = knownTag(trimmed)?.name ?? trimmed;
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(name);
  }
  return tags.slice(0, LIMITS.madeWith);
}

/**
 * People's tags used on fewer slops than this stay out of suggestions, so one
 * person's typo (or worse) isn't offered to everyone. Known tags always show.
 */
export const SUGGEST_AFTER_USES = 2;

/** Known tags and counted ones in one list, most used first, known before unknown on a tie. */
export function tagOptions(counted: readonly { name: string; uses: number }[], now = Date.now()): TagOption[] {
  const uses = new Map(counted.map((row) => [tagKey(row.name), row]));
  const options: TagOption[] = KNOWN_TAGS.filter((tag) => tag.name !== HACKER_HOUSE.tag || hackerHouseActive(now)).map(
    (tag) => ({
      name: tag.name,
      kind: tag.kind,
      uses: uses.get(tagKey(tag.name))?.uses ?? 0,
      aliases: tag.aliases ?? [],
    }),
  );
  for (const row of counted) {
    if (knownTag(row.name) || row.uses < SUGGEST_AFTER_USES) continue;
    options.push({ name: row.name, kind: "other", uses: row.uses, aliases: [] });
  }
  // A stable sort keeps KNOWN_TAGS order (newest models first) among equals.
  return options.sort((a, b) => b.uses - a.uses);
}

/**
 * The options that match what's being typed: names or aliases starting with
 * it first, then ones containing it, most used first within each.
 */
export function matchTags(options: readonly TagOption[], typed: string, picked: readonly string[]): TagOption[] {
  const query = tagKey(typed);
  const taken = new Set(picked.map(tagKey));
  const open = options.filter((option) => !taken.has(tagKey(option.name)));
  if (!query) return open;
  const words = (option: TagOption) => [option.name, ...option.aliases].map(tagKey);
  const starts = open.filter((option) =>
    words(option).some((word) => word.startsWith(query) || word.split(/[\s.-]/).some((part) => part === query)),
  );
  const contains = open.filter((option) => !starts.includes(option) && words(option).some((w) => w.includes(query)));
  return [...starts, ...contains];
}

/**
 * The tag to pick as soon as `typed` is finished: an exact name or alias,
 * when no other tag still starts with it ("Opus 5" waits, since "Opus 5.5"
 * might be next; "Claude Code" goes in at once).
 */
export function exactTag(options: readonly TagOption[], typed: string, picked: readonly string[]): TagOption | null {
  const query = tagKey(typed);
  if (!query) return null;
  const open = options.filter((option) => !picked.some((name) => tagKey(name) === tagKey(option.name)));
  const exact = open.find((option) => [option.name, ...option.aliases].some((name) => tagKey(name) === query));
  if (!exact) return null;
  const longer = open.some(
    (option) => option !== exact && [option.name, ...option.aliases].some((name) => tagKey(name).startsWith(query)),
  );
  return longer ? null : exact;
}
