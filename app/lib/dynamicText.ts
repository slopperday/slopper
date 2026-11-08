import { SOCIAL_PROVIDERS, type SocialProvider } from "./networks";

/**
 * Words that change with the network a post goes to, written once. Post text
 * stores them as plain text, so the API, agents and the server read the same
 * thing the composer shows:
 *
 * - `{{only bluesky threads}}…{{/only}}`: words only those networks get.
 * - `{{@ada}}`: a person from the address book, as they're known on each
 *   network (their handle there, else their name).
 *
 * The composer edits them with canvist: `conditional` marks and `mention`
 * chips (`toEditorDoc`, `fromEditorDoc`). The server and previews resolve
 * them per network (`resolveFor`, used by `destinationFor` and `wordsFor`)
 * before spintax and variables run.
 */

/** Someone posts tag, with the name they go by on each network. */
export interface Person {
  /** What `{{@key}}` names: lowercase letters, digits, `-` and `_`. */
  key: string;
  name: string;
  /** Their handle on each network, as typed. Networks without one get the name. */
  handles: Partial<Record<SocialProvider, string>>;
}

export type Piece =
  | { kind: "text"; text: string; only?: SocialProvider[] }
  | { kind: "person"; key: string; only?: SocialProvider[] };

const PERSON = /\{\{@([a-z0-9_-]{1,40})\}\}/g;
const ONLY = /\{\{only ([a-z ,]+)\}\}([\s\S]*?)\{\{\/only\}\}/gi;

export const PERSON_KEY = /^[a-z0-9_-]{1,40}$/;

/** A key from someone's name: "Ada Lovelace" is `ada-lovelace`. */
export function personKey(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "someone"
  );
}

/** Networks that tag people as `@handle`; Reddit says `u/name`; the rest have no handle in text. */
const AT_HANDLES = new Set<SocialProvider>([
  "x",
  "bluesky",
  "threads",
  "instagram",
  "tiktok",
  "youtube",
  "mastodon",
  "telegram",
]);

/** The networks an `{{only …}}` names, known ones only, in a stable order. */
export function parseWhen(when: string): SocialProvider[] {
  const named = new Set(when.toLowerCase().split(/[\s,]+/));
  return SOCIAL_PROVIDERS.filter((provider) => named.has(provider));
}

export function writeWhen(networks: readonly SocialProvider[]): string {
  return SOCIAL_PROVIDERS.filter((provider) => networks.includes(provider)).join(" ");
}

/** Whether the words use either form. */
export function hasDynamic(text: string): boolean {
  return /\{\{(?:@[a-z0-9_-]{1,40}|only [a-zA-Z ,]+)\}\}/.test(text);
}

function piecesOf(text: string, only?: SocialProvider[]): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const match of text.matchAll(PERSON)) {
    if (match.index > at) pieces.push({ kind: "text", text: text.slice(at, match.index), only });
    pieces.push({ kind: "person", key: match[1], only });
    at = match.index + match[0].length;
  }
  if (at < text.length) pieces.push({ kind: "text", text: text.slice(at), only });
  return pieces;
}

/** The words as pieces, in order. An `{{only}}` naming no known network keeps its words for everyone. */
export function parseDynamic(text: string): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const match of text.matchAll(ONLY)) {
    pieces.push(...piecesOf(text.slice(at, match.index)));
    const networks = parseWhen(match[1]);
    pieces.push(...piecesOf(match[2], networks.length ? networks : undefined));
    at = match.index + match[0].length;
  }
  pieces.push(...piecesOf(text.slice(at)));
  return pieces;
}

function sameOnly(a?: readonly SocialProvider[], b?: readonly SocialProvider[]): boolean {
  return (a ?? []).join(" ") === (b ?? []).join(" ");
}

/** Pieces back to stored words: neighbours for the same networks share one `{{only}}`. */
export function writeDynamic(pieces: readonly Piece[]): string {
  let out = "";
  let open: SocialProvider[] | undefined;
  for (const piece of pieces) {
    if (!sameOnly(open, piece.only)) {
      if (open) out += "{{/only}}";
      open = piece.only?.length ? piece.only : undefined;
      if (open) out += `{{only ${writeWhen(open)}}}`;
    }
    out += piece.kind === "person" ? `{{@${piece.key}}}` : piece.text;
  }
  if (open) out += "{{/only}}";
  return out;
}

/** How one person is written on one network. */
export function personOn(person: Person, provider: SocialProvider): string {
  const handle = person.handles[provider]?.trim().replace(/^@/, "").replace(/^u\//, "");
  if (!handle) return person.name;
  if (provider === "reddit") return `u/${handle}`;
  return AT_HANDLES.has(provider) ? `@${handle}` : handle;
}

/** What one network's copy says: its `{{only}}` words kept, everyone else's dropped, people named its way. */
export function resolveFor(text: string, provider: SocialProvider, people: readonly Person[] = []): string {
  if (!hasDynamic(text)) return text;
  return parseDynamic(text)
    .filter((piece) => !piece.only || piece.only.includes(provider))
    .map((piece) => {
      if (piece.kind === "text") return piece.text;
      const person = people.find((candidate) => candidate.key === piece.key);
      return person ? personOn(person, provider) : piece.key;
    })
    .join("");
}

/** The people the words tag, by key, once each. */
export function taggedKeys(text: string): string[] {
  return [...new Set([...text.matchAll(PERSON)].map((match) => match[1]))];
}

/** People tagged in the words who have no handle on `provider`, so their name goes out instead. */
export function unhandled(text: string, provider: SocialProvider, people: readonly Person[]): Person[] {
  const kept = parseDynamic(text).filter(
    (piece) => piece.kind === "person" && (!piece.only || piece.only.includes(provider)),
  );
  return people.filter(
    (person) =>
      kept.some((piece) => piece.kind === "person" && piece.key === person.key) && !person.handles[provider]?.trim(),
  );
}

// ---------------------------------------------------------------------------
// The composer's canvist document (TipTap-shaped JSON) and back.

interface EditorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface EditorNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: EditorMark[];
  content?: EditorNode[];
}

function marksFor(only?: SocialProvider[]): EditorMark[] | undefined {
  return only?.length ? [{ type: "conditional", attrs: { when: writeWhen(only) } }] : undefined;
}

function withMarks(node: EditorNode, marks?: EditorMark[]): EditorNode {
  return marks ? { ...node, marks } : node;
}

/** Stored words as a canvist document: a paragraph per line, people as mention chips. */
export function toEditorDoc(text: string, people: readonly Person[]): EditorNode {
  const lines: EditorNode[][] = [[]];
  for (const piece of parseDynamic(text)) {
    const marks = marksFor(piece.only);
    if (piece.kind === "person") {
      const name = people.find((person) => person.key === piece.key)?.name ?? piece.key;
      lines
        .at(-1)!
        .push(withMarks({ type: "mention", attrs: { id: piece.key, label: name, mentionSuggestionChar: "@" } }, marks));
      continue;
    }
    piece.text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines.at(-1)!.push(withMarks({ type: "text", text: part }, marks));
    });
  }
  return {
    type: "doc",
    content: lines.map((content) => (content.length ? { type: "paragraph", content } : { type: "paragraph" })),
  };
}

function onlyOf(marks?: EditorMark[]): SocialProvider[] | undefined {
  const when = marks?.find((mark) => mark.type === "conditional")?.attrs?.when;
  const networks = typeof when === "string" ? parseWhen(when) : [];
  return networks.length ? networks : undefined;
}

function inlinePieces(nodes: readonly EditorNode[] = []): Piece[] {
  return nodes.flatMap((node): Piece[] => {
    const only = onlyOf(node.marks);
    if (node.type === "text") return [{ kind: "text", text: node.text ?? "", only }];
    if (node.type === "hardBreak") return [{ kind: "text", text: "\n", only }];
    if (node.type === "mention" && typeof node.attrs?.id === "string" && PERSON_KEY.test(node.attrs.id)) {
      return [{ kind: "person", key: node.attrs.id, only }];
    }
    if (node.type === "mention") {
      const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
      return [{ kind: "text", text: `@${label}`, only }];
    }
    return inlinePieces(node.content);
  });
}

/**
 * A canvist document back to stored words: one line per paragraph. A line
 * break inside words for some networks is theirs too, so the others don't get
 * a stray empty line.
 */
export function fromEditorDoc(doc: EditorNode): string {
  const pieces: Piece[] = [];
  for (const [index, block] of (doc.content ?? []).entries()) {
    const line = inlinePieces(block.content);
    if (index > 0) {
      const before = pieces.at(-1)?.only;
      pieces.push({ kind: "text", text: "\n", only: before && sameOnly(before, line[0]?.only) ? before : undefined });
    }
    pieces.push(...line);
  }
  return writeDynamic(pieces);
}
