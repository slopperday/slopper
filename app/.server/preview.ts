import { lookup } from "node:dns";
import { type IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS, type LinkPreview } from "~/lib/model";
import { uploadImage, type UploadResult } from "./media";

/**
 * Link cards on updates. When a maker asks for one, the server reads the
 * linked page's Open Graph tags and keeps a checked copy of its image
 * (`uploadImage`), so a card never hotlinks someone else's server and its
 * image passes the same content check as an upload.
 *
 * A server that fetches URLs people type is a way into private networks
 * (SSRF), so every request, redirects included, may only reach public
 * addresses on the standard ports. The check runs inside the DNS lookup the
 * socket connects with, so a name can't resolve to a public address for the
 * check and a private one for the connection.
 */

const BLOCKED = new BlockList();
const BLOCKED_V4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;
/**
 * BlockList checks IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) against the
 * IPv4 rules itself, and a ::ffff:0:0/96 rule would match every IPv4 address.
 */
const BLOCKED_V6 = [
  ["::", 127],
  // NAT64 and 6to4 addresses can carry a private IPv4 address.
  ["64:ff9b::", 96],
  ["2002::", 16],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const;
for (const [network, prefix] of BLOCKED_V4) BLOCKED.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of BLOCKED_V6) BLOCKED.addSubnet(network, prefix, "ipv6");

/** Whether an IP address is on the public internet: not private, loopback, link-local or reserved. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

class NotPublicError extends Error {
  readonly code = "ENOTPUBLIC";
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * Resolves like the default lookup, but fails unless every address is public.
 * With `loopback`, 127.0.0.1 and localhost pass too: the e2e stack's fake
 * services live there, and only the integrations transport
 * (SLOPPER_ALLOW_LOCAL_FETCH) ever says yes — link previews refuse loopback
 * everywhere, tests included.
 */
function publicLookup(loopback: boolean): LookupFunction {
  return (hostname, options, callback) => {
    if (loopback && isLoopback(hostname)) return lookup(hostname, options, callback);
    lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "");
      if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
        return callback(new NotPublicError(`${hostname} isn't on the public internet.`), "");
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export interface FetchLimits {
  accept: string;
  maxBytes: number;
  /** Keep the first `maxBytes` of a longer body instead of failing. */
  truncate: boolean;
}

export interface Fetched {
  /** Where it ended up, after redirects. */
  url: URL;
  /** The media type, lowercased, without parameters. */
  contentType: string;
  charset: string | null;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Fetches a public web resource. Tests swap in fakes. */
export type PublicFetch = (url: URL, limits: FetchLimits) => Promise<Fetched>;

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Slopper link previews (+https://slopper.day)";

/** Refuses what the lookup never sees: other schemes, ports, credentials and private IP literals. */
export function assertFetchable(url: URL, loopback = false): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new NotPublicError("Only web pages have previews.");
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const local = loopback && isLoopback(host);
  if (url.port !== "" && !local) {
    throw new NotPublicError("Previews only read pages on the standard web ports.");
  }
  if (url.username || url.password) throw new NotPublicError("Previews don't sign in to pages.");
  if (!local && isIP(host) !== 0 && !isPublicAddress(host)) {
    throw new NotPublicError(`${host} isn't on the public internet.`);
  }
}

function get(url: URL, accept: string, signal: AbortSignal, loopback = false): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        lookup: publicLookup(loopback),
        signal,
        headers: { accept, "accept-encoding": "gzip, deflate, br", "user-agent": USER_AGENT },
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  });
}

function decoded(response: IncomingMessage): Readable {
  const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
  const decoder =
    encoding === "gzip"
      ? createGunzip()
      : encoding === "br"
        ? createBrotliDecompress()
        : encoding === "deflate"
          ? createInflate()
          : null;
  if (!decoder) return response;
  response.on("error", (error) => decoder.destroy(error));
  return response.pipe(decoder);
}

async function readBody(
  response: IncomingMessage,
  { maxBytes, truncate }: FetchLimits,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of decoded(response) as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    size += chunk.byteLength;
    if (size <= maxBytes) continue;
    response.destroy();
    if (!truncate) throw new Error(`It's bigger than ${maxBytes} bytes.`);
    break;
  }
  return new Uint8Array(Buffer.concat(chunks).subarray(0, maxBytes));
}

/** Fetches a public web resource, following up to three redirects, each one checked again. */
export const fetchPublic: PublicFetch = async (start, limits) => {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertFetchable(url);
    const response = await get(url, limits.accept, signal);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && location) {
      response.resume();
      url = new URL(location, url);
      continue;
    }
    if (status !== 200) {
      response.resume();
      throw new Error(`${url.host} answered ${status}.`);
    }
    const [type, ...params] = (response.headers["content-type"] ?? "").split(";");
    const charset = params.map((param) => /^\s*charset=["']?([^"';\s]+)/i.exec(param)?.[1]).find(Boolean) ?? null;
    return { url, contentType: type.trim().toLowerCase(), charset, bytes: await readBody(response, limits) };
  }
  throw new Error("Too many redirects.");
};

/** A service's answer is capped: enough for any API reply, small enough to be safe. */
const SERVICE_BYTES = 2 * 1024 * 1024;

/**
 * One request to a public web service — a Bluesky PDS, a self-hosted
 * PostHog, a slop's website — on the same pinned transport as link previews:
 * the public-address check runs inside the DNS lookup the socket connects
 * with, so a name can't resolve public for the check and private for the
 * connection (SSRF by DNS rebinding). Redirects are not followed: the 3xx
 * answer itself is returned, so nothing is ever connected to but the checked
 * address.
 */
export async function publicFetch(
  url: URL,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array<ArrayBuffer>;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** For the integrations transport under e2e (SLOPPER_ALLOW_LOCAL_FETCH): 127.0.0.1 only. */
    loopback?: boolean;
  } = {},
): Promise<Response> {
  assertFetchable(url, init.loopback);
  const body = init.body;
  return await new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: init.method ?? "GET",
        lookup: publicLookup(init.loopback ?? false),
        signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
        headers: {
          accept: "*/*",
          // The caller reads the body as text; answers stay uncompressed.
          "accept-encoding": "identity",
          "user-agent": USER_AGENT,
          ...(body !== undefined
            ? { "content-length": String(typeof body === "string" ? Buffer.byteLength(body) : body.byteLength) }
            : {}),
          ...init.headers,
        },
      },
      (response) => {
        void (async () => {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of response as AsyncIterable<Buffer>) {
            chunks.push(chunk);
            size += chunk.byteLength;
            if (size > SERVICE_BYTES) {
              response.destroy();
              break;
            }
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve(
            new Response(new Uint8Array(Buffer.concat(chunks).subarray(0, SERVICE_BYTES)), {
              status: response.statusCode ?? 200,
              headers,
            }),
          );
        })().catch(reject);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

/** What a page says about itself, before its image is fetched. */
export interface PageMeta extends LinkPreview {
  imageUrl: URL | null;
}

/** The named entities titles and descriptions use; numeric ones cover the rest. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

/** One line, no control characters, at most `max` characters. */
function clean(text: string, max: number): string {
  const line = text.replace(/[\p{Cc}\s]+/gu, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(/([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    found.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return found;
}

function webUrl(raw: string | undefined, base: URL): URL | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Reads a page's Open Graph and Twitter card tags, falling back to its
 * title and description. Null when it has neither a title nor a description.
 */
export function parsePageMeta(html: string, pageUrl: URL): PageMeta | null {
  const end = html.search(/<\/head\s*>/i);
  const head = end === -1 ? html : html.slice(0, end);
  const meta = new Map<string, string>();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const found = attributes(tag);
    const key = (found.get("property") ?? found.get("name"))?.toLowerCase();
    const content = found.get("content");
    // A blank tag (og:title="") says nothing, so the next source gets its turn.
    if (key && content?.trim() && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];
  const title = clean(meta.get("og:title") ?? meta.get("twitter:title") ?? decodeEntities(titleTag ?? ""), 120);
  const description = clean(
    meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description") ?? "",
    240,
  );
  if (!title && !description) return null;
  const siteName = clean(meta.get("og:site_name") ?? "", 60) || pageUrl.hostname.replace(/^www\./, "");
  const image =
    meta.get("og:image:secure_url") ??
    meta.get("og:image") ??
    meta.get("og:image:url") ??
    meta.get("twitter:image") ??
    meta.get("twitter:image:src");
  return { title: title || siteName, description, siteName, imageUrl: webUrl(image, pageUrl) };
}

/** A card as it's stored on the update. */
export interface StoredPreview extends LinkPreview {
  imageId: Id<"media"> | null;
}

export interface PreviewServices {
  fetch: PublicFetch;
  upload: (ownerId: Id<"users">, bytes: Uint8Array<ArrayBuffer>) => Promise<UploadResult>;
}

const PREVIEW_SERVICES: PreviewServices = {
  fetch: fetchPublic,
  upload: (ownerId, bytes) => uploadImage(ownerId, { bytes, fileName: "link-preview" }),
};

/** A page's head is all a card needs, and it comes first. */
const PAGE_BYTES = 256 * 1024;
const HTML_TYPES: ReadonlySet<string> = new Set(["text/html", "application/xhtml+xml"]);

function decodeText(bytes: Uint8Array, charset: string | null): string {
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch (error) {
    // An unknown charset label: the page is wrong about itself, and UTF-8 is the web's default.
    if (!(error instanceof RangeError)) throw error;
    return new TextDecoder().decode(bytes);
  }
}

/**
 * Reads the card for a link, keeping a checked copy of its image. Null when
 * the page can't be read or says nothing about itself; the link still shows,
 * just without a card. A refused or unreadable image leaves a card without
 * one.
 */
export async function linkPreview(
  ownerId: Id<"users">,
  url: string,
  services: PreviewServices = PREVIEW_SERVICES,
): Promise<StoredPreview | null> {
  let page: Fetched;
  try {
    page = await services.fetch(new URL(url), {
      accept: "text/html,application/xhtml+xml",
      maxBytes: PAGE_BYTES,
      truncate: true,
    });
  } catch (error) {
    console.warn(`No preview for ${url}`, error);
    return null;
  }
  if (!HTML_TYPES.has(page.contentType)) return null;
  const meta = parsePageMeta(decodeText(page.bytes, page.charset), page.url);
  if (!meta) return null;
  const { imageUrl, ...card } = meta;
  return { ...card, imageId: imageUrl ? await previewImage(ownerId, imageUrl, services) : null };
}

async function previewImage(ownerId: Id<"users">, url: URL, services: PreviewServices): Promise<Id<"media"> | null> {
  let image: Fetched;
  try {
    image = await services.fetch(url, {
      accept: "image/png,image/jpeg,image/webp,image/gif",
      maxBytes: LIMITS.mediaBytes,
      truncate: false,
    });
  } catch (error) {
    console.warn(`No preview image from ${url}`, error);
    return null;
  }
  const upload = await services.upload(ownerId, image.bytes);
  if (upload.ok) return upload.id;
  console.warn(`Preview image from ${url} not kept: ${upload.error}`);
  return null;
}
