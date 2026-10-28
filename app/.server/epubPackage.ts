import { SaxesParser } from "saxes";

const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
const PACKAGE_NS = "http://www.idpf.org/2007/opf";
const PACKAGE_TYPE = "application/oebps-package+xml";
const PACKAGE_PARENTS = new Map([
  ["manifest", "package"],
  ["spine", "package"],
  ["item", "package/manifest"],
  ["itemref", "package/spine"],
]);

/** Readers must apply the same interpretation as the extension-based safety scan. */
const MEDIA_TYPES: Readonly<Record<string, readonly string[]>> = {
  "application/xhtml+xml": ["xhtml", "html", "htm"],
  "text/html": ["html", "htm"],
  "image/svg+xml": ["svg"],
  "text/css": ["css"],
  "application/x-dtbncx+xml": ["ncx"],
  "application/smil+xml": ["smil"],
  "application/pls+xml": ["pls"],
  "application/vnd.adobe-page-template+xml": ["xpgt"],
  "application/xml": ["xml"],
  "text/xml": ["xml"],
  "text/plain": ["txt"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "image/avif": ["avif"],
  "image/bmp": ["bmp"],
  "font/ttf": ["ttf"],
  "font/otf": ["otf"],
  "font/collection": ["ttc"],
  "font/woff": ["woff"],
  "font/woff2": ["woff2"],
  "application/vnd.ms-opentype": ["otf", "ttf"],
  "application/font-sfnt": ["otf", "ttf"],
  "application/font-woff": ["woff"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a", "mp4"],
  "video/mp4": ["mp4"],
  "audio/aac": ["aac"],
  "audio/ogg": ["ogg", "oga", "opus"],
  "audio/opus": ["opus"],
  "audio/wav": ["wav"],
  "audio/x-wav": ["wav"],
  "audio/webm": ["webm"],
  "video/webm": ["webm"],
};

interface Element {
  name: string;
  parent: string;
  attributes: Map<string, string>;
}

/** XML is strict here: duplicate attributes, entities and base overrides cannot hide a declaration. */
function elements(xml: string, namespace: string, root: string): Element[] | null {
  if (xml.length > 2 * 1024 * 1024) return null;

  const parser = new SaxesParser({ xmlns: true });
  const parents: string[] = [];
  const found: Element[] = [];

  parser.on("doctype", () => {
    throw new Error("Package DTD");
  });
  parser.on("opentag", (tag) => {
    // Package metadata stays small even for a book at the archive's 5,000-entry cap.
    if (parents.length >= 64 || found.length >= 25_000 || tag.local.length > 128) {
      throw new Error("Package complexity");
    }

    if (parents.length === 0 && (tag.uri !== namespace || tag.local !== root)) {
      throw new Error("Package root");
    }

    const attributes = new Map<string, string>();

    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === "http://www.w3.org/XML/1998/namespace" && attribute.local === "base") {
        throw new Error("Package base");
      }

      if (attribute.uri === "") attributes.set(attribute.local, attribute.value);
    }

    const parent = parents.join("/");

    // Repeated children must not turn one long ancestor name into unbounded copied paths.
    if (parent.length > 1024) throw new Error("Package ancestry");

    if (tag.uri === namespace) found.push({ name: tag.local, parent, attributes });
    // Foreign namespaces cannot impersonate the manifest, spine or rootfiles ancestors.
    parents.push(tag.uri === namespace ? tag.local : "?");
  });
  parser.on("closetag", () => parents.pop());

  try {
    parser.write(xml).close();
    return found;
  } catch {
    return null;
  }
}

/** Resolve one local URI to an exact ZIP entry, decoding once and refusing ambiguous separators or schemes. */
function resourcePath(from: string, href: string): string | null {
  let decoded: string;

  try {
    decoded = decodeURIComponent(href);
  } catch {
    return null;
  }

  if (!decoded || decoded.startsWith("/") || /%2f|%5c/i.test(href) || /[\\:%?#\p{Cc}]/u.test(decoded)) return null;

  const parts = from.split("/").slice(0, -1);

  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (parts.pop() === undefined) return null;
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return parts.join("/") || null;
}

/** Text as a reader decodes it: UTF-16 when it says so, else UTF-8. */
export function decodeEpubText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Refuse package semantics that could make a reader render a resource the scanner treated as inert. */
export function epubPackageProblem(files: ReadonlyMap<string, Uint8Array>): string | null {
  const container = files.get("META-INF/container.xml");
  const roots = container && elements(decodeEpubText(container), CONTAINER_NS, "container");
  const rootfiles = roots?.filter((tag) => tag.name === "rootfile" && tag.parent === "container/rootfiles");

  // Multiple renditions or fallback chains need their own safety model; accept one unambiguous package.
  if (
    rootfiles?.length !== 1 ||
    roots?.filter((tag) => tag.name === "rootfiles" && tag.parent === "container").length !== 1 ||
    roots.some((tag) => tag.name === "rootfile" && tag.parent !== "container/rootfiles")
  ) {
    return "container.xml";
  }

  const rootfile = rootfiles[0].attributes;
  const path = resourcePath("", rootfile.get("full-path") ?? "");
  const bytes = path && files.get(path);

  if (!path || !path.toLowerCase().endsWith(".opf") || !bytes || rootfile.get("media-type") !== PACKAGE_TYPE) {
    return "rootfile";
  }

  const tags = elements(decodeEpubText(bytes), PACKAGE_NS, "package");

  if (
    !tags ||
    tags.some((tag) => PACKAGE_PARENTS.has(tag.name) && PACKAGE_PARENTS.get(tag.name) !== tag.parent) ||
    tags.filter((tag) => tag.name === "manifest" && tag.parent === "package").length !== 1 ||
    tags.filter((tag) => tag.name === "spine" && tag.parent === "package").length !== 1
  ) {
    return path;
  }

  const items = new Map<string, string>();
  const paths = new Set<string>();

  for (const tag of tags.filter((tag) => tag.name === "item" && tag.parent === "package/manifest")) {
    const attributes = tag.attributes;
    const id = attributes.get("id");
    const resource = resourcePath(path, attributes.get("href") ?? "");
    const type = attributes.get("media-type") ?? "";
    const extension = resource?.split("/").at(-1)?.split(".").at(-1)?.toLowerCase() ?? "";

    if (
      !id ||
      !/^[\p{L}_][\p{L}\p{N}\p{M}_.-]*$/u.test(id) ||
      items.has(id) ||
      !resource ||
      paths.has(resource) ||
      !files.has(resource) ||
      !Object.hasOwn(MEDIA_TYPES, type) ||
      !MEDIA_TYPES[type]?.includes(extension) ||
      ((attributes.get("properties") ?? "").split(/\s+/).includes("nav") && type !== "application/xhtml+xml") ||
      ["fallback", "fallback-style", "media-overlay"].some((name) => attributes.has(name))
    ) {
      return resource ?? "manifest item";
    }

    items.set(id, type);
    paths.add(resource);
  }

  const toc = tags.find((tag) => tag.name === "spine" && tag.parent === "package")?.attributes.get("toc");

  if (toc !== undefined && items.get(toc) !== "application/x-dtbncx+xml") return "spine navigation";

  const spine = tags.filter((tag) => tag.name === "itemref" && tag.parent === "package/spine");

  if (spine.length === 0) return "spine";

  for (const tag of spine) {
    const type = items.get(tag.attributes.get("idref") ?? "");

    if (type !== "application/xhtml+xml" && type !== "image/svg+xml") return "spine item";
  }

  return null;
}
