import { crc32, inflateRawSync } from "node:zlib";

/**
 * Slopper's own safety scan for EPUB publications, the EPUB side of
 * ./pdfSafety.ts, run before an EPUB is checked or stored. An EPUB is a ZIP
 * of web pages, styles, images and fonts, so what can harm a reader is what
 * can harm a browser: scripts, event handlers, `javascript:` links, frames,
 * forms, and pages that load things from the web (which also tracks who
 * reads). On top of that come the ZIP's own tricks: files that unpack to
 * gigabytes, names that climb out of the folder, a second file hidden around
 * the archive, and programs packed inside it.
 *
 * So every entry is unpacked (with a cap) and checked against its CRC; the
 * archive must hold the entries it lists and nothing else; every page,
 * drawing and stylesheet is read, and anything active or remote is refused;
 * only the kinds of files a book is made of may be inside; and DRM-encrypted
 * books are refused, since we couldn't see in. Images, fonts and audio are
 * kept as they are, after a check that they aren't programs.
 *
 * The scan also returns the book's text, which the content check reads.
 */

export type EpubProblem = "broken" | "disguised" | "encrypted" | "active" | "remote" | "attachments" | "uninspectable";

export type EpubVerdict = { safe: true; text: string } | { safe: false; reason: EpubProblem; found: string[] };

/** What the maker is told, for each reason an EPUB is refused. */
export const EPUB_PROBLEMS: Readonly<Record<EpubProblem, string>> = {
  broken: "That EPUB looks broken. Export it again and try once more.",
  disguised: "That file isn't only an EPUB, so it can't go on Slopper. Export it again as a plain EPUB.",
  encrypted: "That EPUB is DRM-protected or encrypted, so it can't be checked. Upload a copy without DRM.",
  active:
    "That EPUB has scripts, forms or links that run code, so it can't go on Slopper. Export it again without interactive content.",
  remote:
    "That EPUB loads pictures, styles or media from the web when it's opened. Put them inside the book and upload it again.",
  attachments:
    "That EPUB carries files a book doesn't need (only pages, styles, images, fonts and audio can be inside). Take them out and upload it again.",
  uninspectable: "That EPUB is packed in a way Slopper can't check. Export it again as a plain EPUB.",
};

export const EPUB_TYPE = "application/epub+zip";

/** The most an EPUB may unpack to, all together: past this it's a ZIP bomb. */
export const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

/** More entries than any book needs, and each one costs time to read. */
export const MAX_ENTRIES = 5000;

/** How much of the book's text goes to the content check. */
export const MAX_TEXT_CHARS = 100_000;

/** Files read as markup: pages, drawings, the package and navigation files. */
const MARKUP = new Set(["xhtml", "html", "htm", "xml", "opf", "ncx", "svg", "smil", "pls", "xpgt"]);

/** Files a book is made of that are kept as they are. */
const MEDIA = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ttf",
  "otf",
  "ttc",
  "woff",
  "woff2",
  "mp3",
  "m4a",
  "mp4",
  "aac",
  "ogg",
  "oga",
  "opus",
  "wav",
  "webm",
  "txt",
]);

/** Elements that run code, frame other pages, send data away or change where links go. */
const ACTIVE_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "base",
  "portal",
  "handler",
  "listener",
]);

/** Elements that fetch what an attribute points at as soon as the page shows. */
const LOADING_TAGS = new Set(["img", "image", "audio", "video", "source", "track", "link", "use", "feimage", "input"]);

/** Attributes that hold a URL (or, on SVG animations, a value that becomes one). */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "srcset",
  "action",
  "formaction",
  "data",
  "poster",
  "background",
  "codebase",
  "cite",
  "longdesc",
  "dynsrc",
  "lowsrc",
  "to",
  "from",
  "by",
  "values",
]);

/** URLs that run code or open things a book has no business opening. */
const ACTIVE_URL =
  /^(?:javascript:|vbscript:|livescript:|file:|data:(?:text\/html|text\/xml|application\/|image\/svg))/;

/** URLs that reach the web. */
const REMOTE_URL = /^(?:https?:|ftp:|\/\/)/;

/** DRM-free font obfuscation (IDPF and Adobe): it hides fonts from copying and nothing else. */
const FONT_OBFUSCATION = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);

/** Programs, archives and PDFs, by their first bytes. */
const PROGRAM_MAGIC: readonly number[][] = [
  [0x4d, 0x5a], // MZ: Windows programs
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O and Java classes
  [0x50, 0x4b, 0x03, 0x04], // another ZIP
  [0x25, 0x50, 0x44, 0x46], // %PDF
  [0x23, 0x21], // #! scripts
];

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

type Refusal = { safe: false; reason: EpubProblem; found: string[] };

function refuse(reason: EpubProblem, ...found: string[]): Refusal {
  return { safe: false, reason, found };
}

/** Whether `bytes` starts like an EPUB: a ZIP whose first entry is its `mimetype`. */
export function sniffEpub(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 58));
  return head.startsWith("PK\u0003\u0004") && head.slice(30, 38) === "mimetype";
}

/** The archive's end record, which must close the file: nothing may trail it. */
function endRecord(view: DataView): number | null {
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === view.byteLength) {
      return at;
    }
  }
  return null;
}

/** Reads the central directory, or says why it can't be trusted. */
function entries(bytes: Uint8Array, view: DataView): Entry[] | Refusal {
  const end = endRecord(view);
  if (end === null) return refuse("disguised", "end of archive");
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count) {
    return refuse("uninspectable", "split archive");
  }
  if (count === 0xffff || start === 0xffffffff || size === 0xffffffff) return refuse("uninspectable", "ZIP64");
  if (count > MAX_ENTRIES) return refuse("uninspectable", `${count} files`);
  // The directory sits right before the end record: no room for anything else in between.
  if (start + size !== end) return refuse("disguised", "data around the directory");

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const found: Entry[] = [];
  let at = start;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) return refuse("broken", "directory");
    const nameLength = view.getUint16(at + 28, true);
    const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > end) return refuse("broken", "directory");
    found.push({
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at = next;
  }
  if (at !== end) return refuse("disguised", "data in the directory");
  return found;
}

/** Where an entry's data starts, after its local header, which must agree with the directory. */
function dataStart(bytes: Uint8Array, view: DataView, entry: Entry): number | null {
  const at = entry.offset;
  if (at + 30 > bytes.byteLength || view.getUint32(at, true) !== 0x04034b50) return null;
  const nameLength = view.getUint16(at + 26, true);
  const name = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(at + 30, at + 30 + nameLength));
  if (name !== entry.name || view.getUint16(at + 8, true) !== entry.method) return null;
  return at + 30 + nameLength + view.getUint16(at + 28, true);
}

/** A name a reader would put somewhere else, or that hides what it is. */
function unsafeName(name: string): boolean {
  return (
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes(":") ||
    /\p{Cc}/u.test(name) ||
    name.split("/").some((part) => part === ".." || part === ".")
  );
}

function extension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

/** Text as a reader decodes it: UTF-16 when it says so, else UTF-8. */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  colon: ":",
  tab: "\t",
  newline: "\n",
  nbsp: " ",
};

/** Undoes character references, the way a browser reads an attribute or text. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** A URL as a browser compares its scheme: references undone, spaces and controls dropped, lower case. */
function urlOf(value: string): string {
  return decodeEntities(value)
    .replace(/[\p{Cc}\s]+/gu, "")
    .toLowerCase();
}

/** CSS with its comments gone and its escapes undone, so `\6a avascript:` reads as what it is. */
function plainCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\\(.)/g, "$1");
}

/** What's wrong with some CSS, if anything. */
function cssProblem(css: string): Refusal | null {
  const plain = plainCss(css).toLowerCase();
  if (/expression\s*\(|behavior\s*:|-moz-binding|(?:javascript|vbscript)\s*:/.test(plain)) {
    return refuse("active", "CSS");
  }
  for (const match of plain.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)|@import\s+(['"])([^'"]*)\3/g)) {
    const url = urlOf(match[2] ?? match[4] ?? "");
    if (ACTIVE_URL.test(url)) return refuse("active", "CSS");
    if (REMOTE_URL.test(url)) return refuse("remote", "CSS");
  }
  return null;
}

interface Tag {
  name: string;
  attributes: [string, string][];
}

/**
 * Every start tag in some markup, attributes and all. Quotes are honoured,
 * so a `>` inside a value doesn't end the tag early, the way browsers read
 * it. Comments and CDATA are read through rather than skipped: HTML and XML
 * end them differently, so whatever is inside counts as if it were markup.
 */
export function startTags(markup: string): Tag[] {
  const tags: Tag[] = [];
  for (let at = markup.indexOf("<"); at !== -1; at = markup.indexOf("<", at + 1)) {
    const name = /^<([a-zA-Z][^\s/>]*)/.exec(markup.slice(at, at + 256));
    if (!name) continue;
    const tag: Tag = { name: name[1].toLowerCase(), attributes: [] };
    let cursor = at + name[0].length;
    while (cursor < markup.length) {
      while (cursor < markup.length && /[\s/]/.test(markup[cursor])) cursor++;
      if (cursor >= markup.length || markup[cursor] === ">") break;
      const attribute = /^[^\s/>=]+/.exec(markup.slice(cursor, cursor + 256));
      if (!attribute) {
        cursor++;
        continue;
      }
      cursor += attribute[0].length;
      while (/\s/.test(markup[cursor] ?? "")) cursor++;
      let value = "";
      if (markup[cursor] === "=") {
        cursor++;
        while (/\s/.test(markup[cursor] ?? "")) cursor++;
        const quote = markup[cursor];
        if (quote === '"' || quote === "'") {
          const close = markup.indexOf(quote, cursor + 1);
          const stop = close === -1 ? markup.length : close;
          value = markup.slice(cursor + 1, stop);
          cursor = stop + 1;
        } else {
          const unquoted = /^[^\s>]*/.exec(markup.slice(cursor))?.[0] ?? "";
          value = unquoted;
          cursor += unquoted.length;
        }
      }
      tag.attributes.push([attribute[0].toLowerCase(), value]);
    }
    tags.push(tag);
    at = Math.max(at, cursor - 1);
  }
  return tags;
}

/** The part of a name after its namespace prefix: `xlink:href` is an `href`. */
function localName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1);
}

/** What's wrong with a page, drawing or package file, if anything. */
function markupProblem(name: string, markup: string): Refusal | null {
  // Entities can expand without end (a "billion laughs") or pull in other files: no book needs its own.
  if (/<!ENTITY/i.test(markup) || /<!DOCTYPE[^>[]*\[/i.test(markup)) return refuse("uninspectable", name);
  if (/<\?xml-stylesheet[^>]*(?:href\s*=\s*["']\s*(?:https?:|\/\/))/i.test(markup)) return refuse("remote", name);
  if (/\bproperties\s*=\s*["'][^"']*\bscripted\b/i.test(markup)) return refuse("active", "scripted");
  if (/\bproperties\s*=\s*["'][^"']*\bremote-resources\b/i.test(markup)) return refuse("remote", "remote-resources");

  for (const tag of startTags(markup)) {
    const tagName = localName(tag.name);
    if (ACTIVE_TAGS.has(tagName)) return refuse("active", tagName);
    for (const [rawName, value] of tag.attributes) {
      const attribute = localName(rawName);
      if (attribute.startsWith("on") && attribute.length > 2) return refuse("active", rawName);
      if (tagName === "meta" && attribute === "http-equiv" && /refresh|set-cookie/i.test(value)) {
        return refuse("active", "meta refresh");
      }
      if (attribute === "style") {
        const problem = cssProblem(decodeEntities(value));
        if (problem) return problem;
      }
      if (!URL_ATTRIBUTES.has(attribute)) continue;
      const urls = attribute === "srcset" ? value.split(",").map((part) => part.trim().split(/\s+/)[0] ?? "") : [value];
      for (const url of urls.map(urlOf)) {
        if (ACTIVE_URL.test(url)) return refuse("active", `${rawName}=${url.slice(0, 20)}`);
        if (LOADING_TAGS.has(tagName) && attribute !== "cite" && REMOTE_URL.test(url)) {
          return refuse("remote", `${tagName} ${rawName}`);
        }
      }
    }
  }
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi)) {
    const problem = cssProblem(style[1]);
    if (problem) return problem;
  }
  return null;
}

/** A page's words, for the content check. */
function pageText(markup: string): string {
  return decodeEntities(
    markup
      .replace(/<head\b[\s\S]*?<\/head\s*>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `encryption.xml` only obfuscates fonts, which DRM-free books do too. */
function onlyObfuscatesFonts(xml: string): boolean {
  const algorithms = Array.from(xml.matchAll(/Algorithm\s*=\s*["']([^"']*)["']/g), (match) => match[1]);
  const methods = (xml.match(/<(?:\w+:)?EncryptionMethod\b/g) ?? []).length;
  return methods === algorithms.length && algorithms.every((algorithm) => FONT_OBFUSCATION.has(algorithm));
}

/** Unpacks one entry, or null when it isn't deflate data or would unpack past `limit`. */
function inflate(bytes: Uint8Array, limit: number): Uint8Array | null {
  try {
    return inflateRawSync(bytes, { maxOutputLength: Math.max(1, limit) });
  } catch {
    return null;
  }
}

/** Scans one EPUB. Never throws: anything it can't read is a reason to refuse. */
export function scanEpub(bytes: Uint8Array): EpubVerdict {
  try {
    return scan(bytes);
  } catch {
    return refuse("broken");
  }
}

function scan(bytes: Uint8Array): EpubVerdict {
  if (!sniffEpub(bytes)) return refuse("broken", "mimetype");
  // PDF readers look for their header anywhere in the first 1 KB: a file that's both is a polyglot.
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) return refuse("disguised", "PDF");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const listed = entries(bytes, view);
  if (!Array.isArray(listed)) return listed;

  const names = new Set<string>();
  for (const entry of listed) {
    if (unsafeName(entry.name)) return refuse("disguised", entry.name);
    const key = entry.name.normalize("NFC").toLowerCase();
    if (names.has(key)) return refuse("disguised", `two ${entry.name}`);
    names.add(key);
  }

  // Entries must sit end to end from the start of the file to the directory, so nothing hides between them.
  const ordered = [...listed].sort((a, b) => a.offset - b.offset);
  if (ordered[0]?.name !== "mimetype" || ordered[0].offset !== 0) return refuse("broken", "mimetype");
  const directory = view.getUint32(endRecord(view)! + 16, true);
  const files = new Map<string, Uint8Array>();
  let unpacked = 0;
  let expected = 0;
  for (const [index, entry] of ordered.entries()) {
    if (entry.flags & 0x0001 || entry.flags & 0x0040) return refuse("encrypted", entry.name);
    if (entry.method !== 0 && entry.method !== 8) return refuse("uninspectable", entry.name);
    const start = dataStart(bytes, view, entry);
    if (start === null) return refuse("disguised", entry.name);
    // A data descriptor (12 to 24 bytes) may follow the data when the header couldn't say its size.
    const gap = entry.offset - expected;
    const previous = ordered[index - 1];
    if (gap !== 0 && (!previous || !(previous.flags & 0x0008) || gap < 12 || gap > 24)) {
      return refuse("disguised", entry.name);
    }
    const end = start + entry.compressedSize;
    if (end > directory) return refuse("broken", entry.name);
    expected = end;

    const raw = bytes.subarray(start, end);
    if (entry.size > MAX_UNPACKED_BYTES - unpacked) return refuse("uninspectable", "too big unpacked");
    const data = entry.method === 0 ? raw : inflate(raw, MAX_UNPACKED_BYTES - unpacked);
    if (!data) return refuse("uninspectable", entry.name);
    if (data.byteLength !== entry.size || crc32(data) !== entry.crc) return refuse("broken", entry.name);
    unpacked += data.byteLength;
    if (!entry.name.endsWith("/")) files.set(entry.name, data);
  }
  const tail = directory - expected;
  const last = ordered.at(-1);
  if (tail !== 0 && (!last || !(last.flags & 0x0008) || tail < 12 || tail > 24)) return refuse("disguised", "tail");

  const mimetype = files.get("mimetype");
  if (!mimetype || ordered[0].method !== 0 || new TextDecoder().decode(mimetype).trim() !== EPUB_TYPE) {
    return refuse("broken", "mimetype");
  }
  if (!files.has("META-INF/container.xml")) return refuse("broken", "container.xml");
  if (files.has("META-INF/rights.xml")) return refuse("encrypted", "rights.xml");
  const encryption = files.get("META-INF/encryption.xml");
  if (encryption && !onlyObfuscatesFonts(decodeText(encryption))) return refuse("encrypted", "encryption.xml");

  const text: string[] = [];
  let textLength = 0;
  for (const [name, data] of files) {
    if (name === "mimetype") continue;
    const type = extension(name);
    if (type === "js" || type === "mjs") return refuse("active", name);
    if (type === "css") {
      const problem = cssProblem(decodeText(data));
      if (problem) return problem;
      continue;
    }
    if (MARKUP.has(type)) {
      const markup = decodeText(data);
      const problem = markupProblem(name, markup);
      if (problem) return problem;
      if ((type === "xhtml" || type === "html" || type === "htm") && textLength < MAX_TEXT_CHARS) {
        const words = pageText(markup);
        text.push(words);
        textLength += words.length + 1;
      }
      continue;
    }
    if (!MEDIA.has(type)) return refuse("attachments", name);
    if (PROGRAM_MAGIC.some((magic) => startsWith(data, magic))) return refuse("disguised", name);
  }
  return { safe: true, text: text.join("\n").slice(0, MAX_TEXT_CHARS) };
}
