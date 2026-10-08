/**
 * A stand-in for the Backblaze B2 bucket: an in-memory S3-compatible server
 * for the e2e stack, plus the signature check it runs on every write.
 *
 * The check is written from the AWS Signature V4 spec with node:crypto, not
 * shared with the app's signer (aws4fetch), so a signing bug can't hide on
 * both sides. Unit tests run it against the app's requests too.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

export interface S3Credentials {
  keyId: string;
  secret: string;
  region: string;
}

export interface SignedRequest {
  method: string;
  /** The path and query as sent, still percent-encoded. */
  path: string;
  /** Header values by lower-case name. */
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
}

/** One stored object, as the e2e tests see it. */
export interface FakeObject {
  key: string;
  contentType: string;
  cacheControl: string;
  sha256: string;
  size: number;
}

/** How far a request's clock may drift from ours, as S3 allows. */
const MAX_SKEW_MS = 15 * 60_000;

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function amzTime(stamp: string): number {
  const [year, month, day, hour, minute, second] = [0, 4, 6, 9, 11, 13].map((at, index) =>
    Number(stamp.slice(at, at + (index === 0 ? 4 : 2))),
  );
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Checks a request's AWS Signature V4 the way S3 does. Returns why it's
 * refused, or null when it's valid. Stricter than S3 in one way: the
 * payload must be signed (the app always signs it), never UNSIGNED-PAYLOAD.
 */
export function signatureProblem(request: SignedRequest, credentials: S3Credentials, now = Date.now()): string | null {
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/.exec(
      request.headers.authorization ?? "",
    );
  if (!match) return "malformed authorization header";
  const [, keyId, date, region, signedHeaders, signature] = match;
  if (keyId !== credentials.keyId) return "unknown key id";
  if (region !== credentials.region) return "wrong region";

  const stamp = request.headers["x-amz-date"] ?? "";
  if (!/^\d{8}T\d{6}Z$/.test(stamp) || stamp.slice(0, 8) !== date) return "bad x-amz-date";
  if (Math.abs(now - amzTime(stamp)) > MAX_SKEW_MS) return "request time too skewed";

  const payloadHash = request.headers["x-amz-content-sha256"] ?? "";
  if (payloadHash !== sha256Hex(request.body)) return "payload hash doesn't match the body";

  const names = signedHeaders.split(";");
  for (const required of ["host", "x-amz-content-sha256", "x-amz-date"]) {
    if (!names.includes(required)) return `${required} isn't signed`;
  }
  const [path, query = ""] = request.path.split("?");
  if (query) return "unexpected query string";
  const canonicalHeaders = names
    .map((name) => `${name}:${(request.headers[name] ?? "").trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const canonicalRequest = [request.method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  let key = hmac(`AWS4${credentials.secret}`, date);
  for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
  const expected = hmac(key, stringToSign);
  return timingSafeEqual(expected, Buffer.from(signature, "hex")) ? null : "signature doesn't match";
}

async function readBytes(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function headerMap(request: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name] = Array.isArray(value) ? value.join(",") : value;
  }
  return headers;
}

/**
 * Serves one bucket. Writes go to the S3 path (`/{bucket}/{key}`) and must be
 * signed; reads are public at B2's friendly path (`/file/{bucket}/{key}`),
 * so a mixed-up public URL fails. `GET /__objects` lists what's stored.
 */
export function startFakeS3(port: number, bucket: string, credentials: S3Credentials): void {
  const objects = new Map<string, { body: Buffer; contentType: string; cacheControl: string }>();

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const path = request.url ?? "/";
    const { pathname } = new URL(path, "http://fake-s3");

    if (method === "GET" && pathname === "/__objects") {
      const list: FakeObject[] = [...objects].map(([key, object]) => ({
        key,
        contentType: object.contentType,
        cacheControl: object.cacheControl,
        sha256: sha256Hex(object.body),
        size: object.body.byteLength,
      }));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
      return;
    }

    const publicPrefix = `/file/${bucket}/`;
    if ((method === "GET" || method === "HEAD") && pathname.startsWith(publicPrefix)) {
      const object = objects.get(decodeURIComponent(pathname.slice(publicPrefix.length)));
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": object.contentType,
        "cache-control": object.cacheControl,
        "content-length": object.body.byteLength,
      });
      response.end(method === "HEAD" ? undefined : object.body);
      return;
    }

    const s3Prefix = `/${bucket}/`;
    if (!pathname.startsWith(s3Prefix)) {
      response.writeHead(404).end("NoSuchBucket");
      return;
    }
    const key = decodeURIComponent(pathname.slice(s3Prefix.length));
    const body = await readBytes(request);
    const problem = signatureProblem({ method, path, headers: headerMap(request), body }, credentials);
    if (problem) {
      response.writeHead(403).end(`SignatureDoesNotMatch: ${problem}`);
      return;
    }
    if (method === "PUT") {
      objects.set(key, {
        body,
        contentType: request.headers["content-type"] ?? "application/octet-stream",
        cacheControl: request.headers["cache-control"] ?? "",
      });
      response.writeHead(200, { etag: `"${createHash("md5").update(body).digest("hex")}"` }).end();
      return;
    }
    if (method === "DELETE") {
      objects.delete(key);
      response.writeHead(204).end();
      return;
    }
    response.writeHead(405).end();
  });
  server.listen(port, "127.0.0.1");
}
