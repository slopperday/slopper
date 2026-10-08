import { describe, expect, it } from "vite-plus/test";
import { loadConfig } from "~/.server/config";
import { ConvexStorage, mediaStore, S3Bucket } from "~/.server/storage";
import { sha256Hex, signatureProblem, type SignedRequest } from "../e2e/fake-s3.ts";

const B2 = {
  endpoint: "https://s3.us-west-004.backblazeb2.com",
  region: "us-west-004",
  bucket: "slopper-media",
  keyId: "004a1b2c3d4e5f60000000001",
  applicationKey: "K004-application-key",
};
const CREDENTIALS = { keyId: B2.keyId, secret: B2.applicationKey, region: B2.region };
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/** A fetch that records requests and answers every one with `status`. */
function bucketFetch(status: number) {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(status === 500 ? "InternalError" : null, { status });
  };
  return { requests, fetcher };
}

/** The request as the bucket sees it, Host header included (fetch adds it on the wire). */
async function asSent(request: Request): Promise<SignedRequest> {
  const url = new URL(request.url);
  return {
    method: request.method,
    path: url.pathname + url.search,
    headers: { ...Object.fromEntries(request.headers), host: url.host },
    body: new Uint8Array(await request.arrayBuffer()),
  };
}

describe("S3 bucket", () => {
  it("signs a PUT with AWS Signature V4 that the bucket accepts", async () => {
    const { requests, fetcher } = bucketFetch(200);
    const location = await new S3Bucket(B2, fetcher).put(BYTES, "image/png", "screenshot");
    if (location.backend !== "b2") throw new Error("Expected a B2 location.");
    expect(location.key).toMatch(/^screenshots\/[\w-]{24}\.png$/);

    const [request] = requests;
    expect(request.method).toBe("PUT");
    // Path-style, which any S3-compatible API serves.
    expect(request.url).toBe(`https://s3.us-west-004.backblazeb2.com/slopper-media/${location.key}`);
    expect(request.headers.get("content-type")).toBe("image/png");
    expect(request.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(request.headers.get("x-amz-content-sha256")).toBe(sha256Hex(BYTES));
    const stamp = request.headers.get("x-amz-date") ?? "";
    expect(stamp).toMatch(/^\d{8}T\d{6}Z$/);
    expect(request.headers.get("authorization")).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=${B2.keyId}/${stamp.slice(0, 8)}/us-west-004/s3/aws4_request, ` +
          "SignedHeaders=cache-control;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$",
      ),
    );

    // An independent SigV4 check (e2e/fake-s3.ts) accepts it, and catches tampering.
    const sent = await asSent(request);
    expect(sent.body).toEqual(BYTES);
    expect(signatureProblem(sent, CREDENTIALS)).toBeNull();
    expect(signatureProblem({ ...sent, body: new Uint8Array([1, 2, 3]) }, CREDENTIALS)).toBe(
      "payload hash doesn't match the body",
    );
    expect(signatureProblem({ ...sent, headers: { ...sent.headers, "cache-control": "no-store" } }, CREDENTIALS)).toBe(
      "signature doesn't match",
    );
    expect(signatureProblem(sent, { ...CREDENTIALS, secret: "wrong" })).toBe("signature doesn't match");
  });

  it("gives every upload its own key, in a folder for its kind", async () => {
    const bucket = new S3Bucket(B2, bucketFetch(200).fetcher);
    const [first, second] = await Promise.all([
      bucket.put(BYTES, "image/webp", "screenshot"),
      bucket.put(BYTES, "image/webp", "screenshot"),
    ]);
    expect(first).not.toEqual(second);
    expect(await bucket.put(BYTES, "image/jpeg", "avatar")).toMatchObject({
      key: expect.stringMatching(/^avatars\/.+\.jpg$/),
    });
  });

  it("throws when the bucket refuses a write", async () => {
    await expect(new S3Bucket(B2, bucketFetch(403).fetcher).put(BYTES, "image/png", "screenshot")).rejects.toThrow(
      /The bucket refused screenshots\/.+ \(403\)/,
    );
  });

  it("signs deletes, and counts an object that's already gone as deleted", async () => {
    const { requests, fetcher } = bucketFetch(204);
    await new S3Bucket(B2, fetcher).remove("screenshots/abc.png");
    expect(requests[0].method).toBe("DELETE");
    expect(requests[0].url).toBe("https://s3.us-west-004.backblazeb2.com/slopper-media/screenshots/abc.png");
    expect(signatureProblem(await asSent(requests[0]), CREDENTIALS)).toBeNull();

    await expect(new S3Bucket(B2, bucketFetch(404).fetcher).remove("screenshots/abc.png")).resolves.toBeUndefined();
    await expect(new S3Bucket(B2, bucketFetch(500).fetcher).remove("screenshots/abc.png")).rejects.toThrow(
      "didn't delete screenshots/abc.png (500): InternalError",
    );
  });
});

describe("storage selection", () => {
  const env = {
    B2_ENDPOINT: " https://s3.us-west-004.backblazeb2.com/ ",
    B2_REGION: "us-west-004",
    B2_BUCKET: "slopper-media",
    B2_KEY_ID: B2.keyId,
    B2_APPLICATION_KEY: B2.applicationKey,
  };

  it("uses Convex storage when no B2 variable is set", () => {
    const { b2 } = loadConfig({});
    expect(b2).toBeNull();
    expect(mediaStore(b2)).toBeInstanceOf(ConvexStorage);
  });

  it("uses the B2 bucket when all of them are set", () => {
    const { b2 } = loadConfig(env);
    expect(b2).toEqual(B2);
    const store = mediaStore(b2);
    expect(store).toBeInstanceOf(S3Bucket);
    expect(store.backend).toBe("b2");
  });

  it("refuses to start half configured, rather than quietly falling back", () => {
    expect(() => loadConfig({ ...env, B2_KEY_ID: "", B2_APPLICATION_KEY: undefined })).toThrow(
      "B2 storage is half configured. Set B2_KEY_ID, B2_APPLICATION_KEY too",
    );
    expect(() => loadConfig({ ...env, B2_ENDPOINT: "s3.us-west-004" })).toThrow("B2_ENDPOINT isn't a URL");
  });
});
