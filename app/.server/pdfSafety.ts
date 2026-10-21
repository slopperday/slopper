import { constants, inflateSync } from "node:zlib";

/**
 * Slopper's own safety scan for publications, run on every PDF before it's
 * checked or stored (`uploadPublication` in ./media.ts). A PDF is a document
 * and also a container: it can carry scripts, actions that run when it's
 * opened, other files, and forms that send data away, and those are what
 * PDF malware uses. A publication is something to read, so none of them is
 * allowed, and anything this scan can't see into is refused too.
 *
 * Like pdfid (https://blog.didierstevens.com/programs/pdf-tools/), it looks
 * for the names that turn those features on, after undoing the tricks that
 * hide them: `#xx` escapes in names (`/J#61vaScript`), and objects packed
 * into compressed object streams, which are inflated and read as well.
 * Stream data is skipped only where the PDF's own `/Length` says it ends at
 * an `endstream`, so nothing can hide objects inside a fake stream.
 */

export type PdfVerdict = { safe: true } | { safe: false; reason: PdfProblem; found: string[] };

export type PdfProblem = "broken" | "disguised" | "encrypted" | "active" | "attachments" | "uninspectable";

/** What the maker is told, for each reason a PDF is refused. */
export const PDF_PROBLEMS: Readonly<Record<PdfProblem, string>> = {
  broken: "That PDF looks broken. Export it again and try once more.",
  disguised: "That file isn't only a PDF, so it can't go on Slopper. Export it again as a plain PDF.",
  encrypted: "That PDF is password-protected or encrypted, so it can't be checked. Save a copy without the password.",
  active:
    "That PDF has scripts, forms or actions that run when it's opened, so it can't go on Slopper. Export it again as a plain PDF (Print to PDF works).",
  attachments: "That PDF carries other files inside it. Take the attachments out and upload it again.",
  uninspectable: "That PDF is packed in a way Slopper can't check. Export it again as a plain PDF.",
};

/** Names that run code, act on their own, send data away or open other files. */
const ACTIVE = new Set([
  "JavaScript",
  "JS",
  "Launch",
  "SubmitForm",
  "ImportData",
  "GoToE",
  "GoToR",
  "XFA",
  "RichMedia",
  "Movie",
  "Sound",
]);

/** Names that put other files inside the PDF. */
const ATTACHMENTS = new Set(["EmbeddedFile", "EmbeddedFiles", "FileAttachment"]);

/** The most an upload's object streams may inflate to, together: past this it's a decompression bomb. */
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;

/** A name's characters: anything up to whitespace or a delimiter (ISO 32000-1, 7.2.2). */
const NAME = /\/([^\s/<>[\]()%{}]*)/g;

function decodeName(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Every name in some PDF text, with its `#xx` escapes undone. */
export function pdfNames(text: string): string[] {
  return Array.from(text.matchAll(NAME), (match) => decodeName(match[1]));
}

/** Byte for byte, so offsets in the text are offsets in the file. */
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return text;
}

/**
 * Inflates zlib data, stopping where the stream ends (deflate marks its own
 * end, so the bytes after it are ignored). A stream cut short gives what it
 * holds. Null when it isn't zlib data, or would inflate past `limit`.
 */
function inflate(bytes: Uint8Array, limit: number): Uint8Array | null {
  try {
    return inflateSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: Math.max(1, limit) });
  } catch {
    return null;
  }
}

/** Every plain integer object (`12 0 obj 3451 endobj`), which is how many PDFs give a stream's /Length. */
function integerObjects(text: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const match of text.matchAll(/(?:^|\s)(\d+)\s+(\d+)\s+obj\s*(\d+)\s*endobj/g)) {
    found.set(`${match[1]} ${match[2]}`, Number(match[3]));
  }
  return found;
}

/** A stream's length, when the PDF states it plainly: directly, or as one indirect integer object. */
function streamLength(dict: string, integers: () => Map<string, number>): number | null {
  const ref = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (ref) return integers().get(`${ref[1]} ${ref[2]}`) ?? null;
  const direct = /\/Length\s+(\d+)/.exec(dict);
  return direct ? Number(direct[1]) : null;
}

/** Scans one PDF. Never throws: anything it can't read is a reason to refuse. */
export function scanPdf(bytes: Uint8Array): PdfVerdict {
  const text = latin1(bytes);
  // Readers let a PDF start late, which is how other files pass as one; a publication starts with its header.
  if (!text.startsWith("%PDF-") && text.slice(0, 1024).includes("%PDF-")) {
    return { safe: false, reason: "disguised", found: [] };
  }
  if (!text.startsWith("%PDF-") || !/\bobj\b/.test(text) || !text.includes("%%EOF")) {
    return { safe: false, reason: "broken", found: [] };
  }
  // A ZIP, a web page or a program in the same bytes: a polyglot, which opens as something else too.
  // (A ZIP's end record sits in its last 64 KB.)
  if (text.slice(-66_000).includes("PK\u0005\u0006") || /<script|<html|MZ\x90\0/i.test(text.slice(0, 4096))) {
    return { safe: false, reason: "disguised", found: [] };
  }

  // The text outside stream data, plus every object stream's objects, inflated.
  const outside: string[] = [];
  const packed: string[] = [];
  let inflated = 0;
  let cursor = 0;
  const keyword = /(?<!end)stream(\r\n|\n|\r)/g;
  // Where the last stream's data ended: everything from there to the next stream keyword is its dictionary
  // and plain objects. Read as one, a string inside the dictionary can't cut off the names before it.
  let boundary = 0;
  let found: Map<string, number> | null = null;
  const integers = () => (found ??= integerObjects(text));
  for (let match = keyword.exec(text); match; match = keyword.exec(text)) {
    const dataStart = match.index + match[0].length;
    const before = text.slice(boundary, match.index);
    const names = new Set(pdfNames(before));
    boundary = dataStart;

    // An object stream is inflated whatever its /Length says: deflate ends itself, so a wrong one can't cut
    // objects off. Filters or predictors that would scramble its names make it one Slopper can't read.
    if (names.has("ObjStm")) {
      const filters = [...names].filter((name) => name.endsWith("Decode") || name === "Crypt");
      if (filters.some((name) => name !== "FlateDecode") || names.has("Predictor")) {
        return { safe: false, reason: "uninspectable", found: ["ObjStm", ...filters] };
      }
      const objects = filters.length > 0 ? inflate(bytes.subarray(dataStart), MAX_INFLATED_BYTES - inflated) : null;
      if (filters.length > 0 && !objects) return { safe: false, reason: "uninspectable", found: ["ObjStm"] };
      if (objects) {
        inflated += objects.byteLength;
        packed.push(latin1(objects));
      }
    }

    // Skip the data only where /Length lands on its endstream; otherwise it's all read as text.
    const header = Array.from(before.matchAll(/\d+\s+\d+\s+obj\b/g)).at(-1);
    const length = streamLength(before.slice(header?.index ?? 0), integers);
    const end = length === null ? -1 : dataStart + length;
    if (end < 0 || end > text.length || !/^\s*endstream/.test(text.slice(end, end + 32))) continue;
    outside.push(text.slice(cursor, dataStart));
    cursor = end;
    boundary = end;
    keyword.lastIndex = end;
  }
  outside.push(text.slice(cursor));

  const readable = [...outside, ...packed].join("\n");
  const names = new Set(pdfNames(readable));
  if (names.has("Encrypt")) return { safe: false, reason: "encrypted", found: ["Encrypt"] };
  const active = [...ACTIVE].filter((name) => names.has(name));
  if (/\/URI\s*\(\s*(?:javascript|vbscript|data|file):/i.test(readable)) active.push("URI");
  if (active.length > 0) return { safe: false, reason: "active", found: active };
  const attached = [...ATTACHMENTS].filter((name) => names.has(name));
  if (attached.length > 0) return { safe: false, reason: "attachments", found: attached };
  return { safe: true };
}
