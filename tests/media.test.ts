// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import type { ConvexCaller } from "~/.server/convex";
import { encodeBase64 } from "~/.server/encoding";
import { BLOCKED_IMAGE, deleteOrphanedMedia, type UploadServices, uploadImage } from "~/.server/media";
import { ConvexStorage, type MediaKind, type MediaLocation, type MediaStore, S3Bucket } from "~/.server/storage";
import { LIMITS } from "~/lib/model";

const modules = import.meta.glob("../convex/**/*.ts");

const MEDIA_URL = "https://media.test/file/slopper-media";
const CHECK = {
  apiKey: "key",
  baseUrl: "https://openrouter.test/api/v1",
  model: "deepseek/deepseek-v4.1-flash",
  provider: "deepseek",
};
const B2 = {
  endpoint: "https://s3.us-west-004.backblazeb2.com",
  region: "us-west-004",
  bucket: "slopper-media",
  keyId: "key-id",
  applicationKey: "application-key",
};
/** PNG magic bytes are all the type sniffing needs. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup() {
  vi.stubEnv("MEDIA_PUBLIC_URL", `${MEDIA_URL}/`);
  const t = convexTest(schema, modules);
  return { t, server: t.withIdentity({ subject: "server" }) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Server = ReturnType<typeof setup>["server"];

/**
 * The app server's line to Convex, answered by convex-test. Its signatures are
 * conditional types a generic caller can't be matched against, so each call
 * names the plain reference type.
 */
function caller(server: Server): ConvexCaller {
  return {
    query: async (query, ...args) => await server.query<FunctionReference<"query">>(query, ...args),
    mutation: async (mutation, ...args) => await server.mutation<FunctionReference<"mutation">>(mutation, ...args),
  };
}

async function makeUser(server: Server, name: string): Promise<Id<"users">> {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: name,
    preferredUsername: name,
    displayName: name,
    avatarUrl: null,
    timeZone: "UTC",
  });
  return userId;
}

function slopInput(screenshots: readonly string[]) {
  return {
    name: "TiltMaze",
    tagline: "Tilt to play",
    description: "",
    category: "games",
    links: [{ kind: "website" as const, url: "https://tiltmaze.app/" }],
    screenshots: [...screenshots],
    madeWith: [],
  };
}

async function ship(server: Server, userId: Id<"users">, screenshots: readonly string[], relaunchOf?: Id<"slops">) {
  return await server.mutation(api.slops.create, {
    userId,
    input: slopInput(screenshots),
    launchNote: "Day 1",
    today: new Date().toISOString().slice(0, 10),
    ...(relaunchOf ? { relaunchOf, launchLabel: "iOS app" } : {}),
  });
}

/** A bucket that keeps what it's given, in memory. */
class MemoryBucket implements MediaStore {
  readonly backend = "b2";
  readonly objects = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array<ArrayBuffer>, _contentType: string, kind: MediaKind): Promise<MediaLocation> {
    const key = `${kind}s/${this.objects.size + 1}.png`;
    this.objects.set(key, bytes);
    return { backend: "b2", key };
  }
}

/** The content check giving every check one verdict (null: it's down), recording what it was sent. */
function contentCheck(verdict: "ok" | "mature" | "blocked" | null) {
  const bodies: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    if (verdict === null) return new Response("Service unavailable", { status: 503 });
    const content = JSON.stringify({ verdict, reason: `Looks ${verdict}.` });
    return Response.json({ choices: [{ message: { content } }] });
  };
  return { bodies, fetcher };
}

function services(server: Server, store: MediaStore, fetcher: typeof fetch, checked = true): UploadServices {
  return { store, convex: caller(server), contentCheck: checked ? CHECK : null, fetcher };
}

async function mediaRows(t: ReturnType<typeof setup>["t"]) {
  return await t.run(async (ctx) => await ctx.db.query("media").collect());
}

describe("upload check", () => {
  it("refuses a blocked image before anything is stored", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "maker");
    const bucket = new MemoryBucket();
    const check = contentCheck("blocked");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await uploadImage(
      owner,
      { bytes: PNG, fileName: "launch.png" },
      services(server, bucket, check.fetcher),
    );
    expect(result).toEqual({ ok: false, error: BLOCKED_IMAGE });
    expect(bucket.objects.size).toBe(0);
    expect(await mediaRows(t)).toEqual([]);
    // The check read the upload's own bytes, inline, with its file name.
    expect(check.bodies[0]).toContain(`data:image/png;base64,${encodeBase64(PNG)}`);
    expect(check.bodies[0]).toContain("launch.png");
    expect(warn).toHaveBeenCalledWith(`Refused an upload from ${owner}: Looks blocked.`);
  });

  it("stores a mature image marked as such, and blurs the slop that shows it", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "maker");
    const bucket = new MemoryBucket();
    const result = await uploadImage(owner, { bytes: PNG }, services(server, bucket, contentCheck("mature").fetcher));
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ contentCheck: "mature", url: `${MEDIA_URL}/screenshots/1.png` });
    expect(bucket.objects.get("screenshots/1.png")).toEqual(PNG);

    const created = await ship(server, owner, [result.id]);
    expect(created.blurred).toBe(true);
    const slopId = created.slopId;
    expect(await server.query(api.slops.getForServer, { slopId })).toMatchObject({
      nsfw: true,
      check: { verdict: "mature", reason: "A screenshot: Looks mature." },
    });
    expect(await server.query(api.moderation.autopostHoldFor, { slopId })).toBe("it's marked NSFW");
    const [queued] = await server.query(api.moderation.queue, {});
    expect(queued.flags.map((flag) => flag.reason)).toEqual(["Content check (mature): A screenshot: Looks mature."]);

    // A moderator's call sticks: re-saving with the same screenshot doesn't blur it again.
    await server.mutation(api.moderation.decide, { slopId, decision: "fine" });
    const edited = await server.mutation(api.slops.edit, { userId: owner, slopId, input: slopInput([result.id]) });
    expect(edited).toEqual({ blurred: false, orphaned: 0 });
    expect((await server.query(api.slops.getForServer, { slopId }))?.nsfw).toBe(false);
  });

  it("accepts an image as unchecked when the check can't run, and leaves the launch check to pass it", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "maker");
    const bucket = new MemoryBucket();
    const notConfigured = contentCheck("ok");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unconfigured = await uploadImage(
      owner,
      { bytes: PNG },
      services(server, bucket, notConfigured.fetcher, false),
    );
    const down = await uploadImage(owner, { bytes: PNG }, services(server, bucket, contentCheck(null).fetcher));

    expect(unconfigured).toMatchObject({ ok: true, contentCheck: "unchecked" });
    expect(down).toMatchObject({ ok: true, contentCheck: "unchecked" });
    expect(notConfigured.bodies).toEqual([]);
    expect(error).toHaveBeenCalledWith("Content check failed", expect.any(Error));
    expect(bucket.objects.size).toBe(2);
    expect((await mediaRows(t)).map((media) => media.check?.verdict)).toEqual(["unchecked", "unchecked"]);

    if (!unconfigured.ok) throw new Error(unconfigured.error);
    const { slopId, blurred } = await ship(server, owner, [unconfigured.id]);
    expect(blurred).toBe(false);
    expect(await server.query(api.moderation.autopostHoldFor, { slopId })).toBe("the content check hasn't passed yet");
  });

  it("refuses a mature avatar too: avatars are never blurred", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "maker");
    const bucket = new MemoryBucket();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const withVerdict = (verdict: "ok" | "mature") => services(server, bucket, contentCheck(verdict).fetcher);
    expect(await uploadImage(owner, { bytes: PNG, kind: "avatar" }, withVerdict("mature"))).toEqual({
      ok: false,
      error: BLOCKED_IMAGE,
    });
    expect(await mediaRows(t)).toEqual([]);
    expect(await uploadImage(owner, { bytes: PNG, kind: "avatar" }, withVerdict("ok"))).toMatchObject({
      ok: true,
      url: `${MEDIA_URL}/avatars/1.png`,
    });
  });

  it("refuses B2 uploads when Convex couldn't build their URLs", async () => {
    const { server } = setup();
    vi.stubEnv("MEDIA_PUBLIC_URL", "");
    const owner = await makeUser(server, "maker");
    const bucket = new MemoryBucket();
    await expect(
      uploadImage(owner, { bytes: PNG }, services(server, bucket, contentCheck("ok").fetcher)),
    ).rejects.toThrow("MEDIA_PUBLIC_URL");
    expect(bucket.objects.size).toBe(0);
  });

  it("still sniffs the type and caps the size", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "maker");
    const check = contentCheck("ok");
    const upload = (bytes: Uint8Array<ArrayBuffer>) =>
      uploadImage(owner, { bytes }, services(server, new MemoryBucket(), check.fetcher));
    expect(await upload(new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      error: "Use a PNG, JPEG, WebP or GIF image.",
    });
    const huge = new Uint8Array(LIMITS.mediaBytes + 1);
    huge.set(PNG);
    expect(await upload(huge)).toEqual({ ok: false, error: "Images must be 4 MB or smaller." });
    expect(check.bodies).toEqual([]);
  });
});

describe("Convex storage", () => {
  it("stores through an upload URL, and rows from before B2 still resolve", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "maker");
    const check = contentCheck("ok");
    // Convex's upload endpoint: store the posted bytes, answer with their id.
    const fetcher: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.startsWith(CHECK.baseUrl)) return await check.fetcher(input, init);
      const blob = new Blob([await new Response(init?.body).arrayBuffer()], { type: "image/png" });
      return Response.json({ storageId: await t.run(async (ctx) => await ctx.storage.store(blob)) });
    };
    const result = await uploadImage(
      owner,
      { bytes: PNG },
      services(server, new ConvexStorage(caller(server), fetcher), fetcher),
    );
    expect(result).toMatchObject({ ok: true, contentCheck: "ok", url: expect.any(String) });
    const [stored] = await mediaRows(t);
    expect(stored).toMatchObject({ backend: "convex", size: PNG.byteLength, contentType: "image/png" });

    // Media rows written before B2 have no backend field.
    const legacy = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([PNG], { type: "image/png" }));
      return await ctx.db.insert("media", { storageId, ownerId: owner, contentType: "image/png", size: PNG.length });
    });
    expect(await server.query(api.media.url, { mediaId: legacy })).toEqual(expect.any(String));
  });
});

describe("orphaned screenshots", () => {
  it("deletes what no launch shows any more: Convex files at once, B2 objects through the app server", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "maker");
    const bucket = new MemoryBucket();
    const uploaded = await uploadImage(owner, { bytes: PNG }, services(server, bucket, contentCheck("ok").fetcher));
    if (!uploaded.ok) throw new Error(uploaded.error);
    const inB2 = uploaded.id;
    const { inConvex, storageId } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([PNG], { type: "image/png" }));
      const inConvex = await ctx.db.insert("media", {
        storageId,
        ownerId: owner,
        contentType: "image/png",
        size: PNG.length,
      });
      return { inConvex, storageId };
    });

    // A relaunch shares the first launch's screenshot.
    const first = await ship(server, owner, [inB2, inConvex]);
    const relaunch = await ship(server, owner, [inB2], first.slopId);
    const removeAs = (slopId: Id<"slops">) =>
      server.mutation(api.slops.remove, { slopId, byUserId: owner, asAdmin: false });
    expect(await removeAs(relaunch.slopId)).toEqual({ orphaned: 0 });
    expect(await server.query(api.media.url, { mediaId: inB2 })).toBe(`${MEDIA_URL}/screenshots/1.png`);

    // Dropping a Convex-stored screenshot deletes the file in the same transaction.
    const edited = await server.mutation(api.slops.edit, {
      userId: owner,
      slopId: first.slopId,
      input: slopInput([inB2]),
    });
    expect(edited).toEqual({ blurred: false, orphaned: 0 });
    expect(await t.run(async (ctx) => [await ctx.db.get(inConvex), await ctx.storage.getUrl(storageId)])).toEqual([
      null,
      null,
    ]);

    // The last launch showing the B2 one goes: it's marked, and nothing can attach it again.
    expect(await removeAs(first.slopId)).toEqual({ orphaned: 1 });
    expect(await server.query(api.media.url, { mediaId: inB2 })).toBeNull();
    expect(await server.query(api.media.orphans, { limit: 10 })).toEqual([{ id: inB2, key: "screenshots/1.png" }]);
    const reuse = await ship(server, owner, [inB2]);
    expect((await server.query(api.slops.getForServer, { slopId: reuse.slopId }))?.screenshots).toEqual([]);

    // A delete the bucket refuses stays queued; one it confirms is forgotten.
    const deletes: string[] = [];
    const bucketAnswering =
      (status: number): typeof fetch =>
      async (input, init) => {
        const request = new Request(input, init);
        deletes.push(`${request.method} ${request.url} ${status}`);
        return new Response(null, { status });
      };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await deleteOrphanedMedia(new S3Bucket(B2, bucketAnswering(500)), caller(server));
    expect(await server.query(api.media.orphans, { limit: 10 })).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      "Couldn't delete screenshots/1.png from the bucket; it stays queued",
      expect.any(Error),
    );
    await deleteOrphanedMedia(new S3Bucket(B2, bucketAnswering(204)), caller(server));
    expect(await server.query(api.media.orphans, { limit: 10 })).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.get(inB2))).toBeNull();
    expect(deletes).toEqual([
      "DELETE https://s3.us-west-004.backblazeb2.com/slopper-media/screenshots/1.png 500",
      "DELETE https://s3.us-west-004.backblazeb2.com/slopper-media/screenshots/1.png 204",
    ]);
  });
});
