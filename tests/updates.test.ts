// @vitest-environment edge-runtime
import type { FunctionArgs, FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ConvexCaller } from "~/.server/convex";
import { convex } from "~/.server/convex";
import type { UpdateForm } from "~/.server/forms";
import { uploadImage } from "~/.server/media";
import { type Fetched, linkPreview, type PreviewServices } from "~/.server/preview";
import type { MediaKind, MediaLocation, MediaStore } from "~/.server/storage";
import { postUpdate } from "~/.server/updates";
import { convexApp } from "./convexApp";

const MEDIA_URL = "https://media.test/file/slopper-media";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup() {
  vi.stubEnv("MEDIA_PUBLIC_URL", MEDIA_URL);
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Setup = ReturnType<typeof setup>;

/** Seed an update through the same quota reservation as the app server. */
async function addUpdate({ server }: Setup, args: Omit<FunctionArgs<typeof api.activity.addUpdate>, "reservationId">) {
  const reservationId = await server.mutation(api.activity.reserveUpdate, {
    userId: args.userId,
    slopId: args.slopId,
  });

  return await server.mutation(api.activity.addUpdate, { ...args, reservationId });
}

async function makeUser({ server }: Setup, name: string): Promise<Id<"users">> {
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

async function ship({ server }: Setup, userId: Id<"users">, screenshots: string[] = []): Promise<Id<"slops">> {
  const { slopId } = await server.mutation(api.slops.create, {
    userId,
    input: {
      name: "TiltMaze",
      tagline: "Tilt to play",
      description: "",
      category: "games",
      links: [{ kind: "website", url: "https://tiltmaze.app/" }],
      screenshots,
      madeWith: [],
    },
    launchNote: "Day 1",
  });
  return slopId;
}

/** A B2 image row, as `uploadImage` would register it. */
async function image({ t }: Setup, ownerId: Id<"users">, key: string, verdict: "ok" | "mature" = "ok") {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("media", {
        ownerId,
        contentType: "image/png",
        size: PNG.length,
        check: { verdict, reason: `Looks ${verdict}.` },
        backend: "b2",
        key,
      }),
  );
}

async function slopPage({ server }: Setup) {
  const page = await server.query(api.slops.page, { username: "maker", slug: "tiltmaze" });
  if (!page) throw new Error("No page");
  return page;
}

describe("update metadata", () => {
  it("keeps the version, details, owned images and link cards, and shows them as URLs", async () => {
    const setupResult = setup();
    const owner = await makeUser(setupResult, "maker");
    const stranger = await makeUser(setupResult, "stranger");
    const slopId = await ship(setupResult, owner);
    const shot = await image(setupResult, owner, "screenshots/editor.png");
    const card = await image(setupResult, owner, "screenshots/card.png");
    const theirs = await image(setupResult, stranger, "screenshots/theirs.png");

    await addUpdate(setupResult, {
      userId: owner,
      slopId,
      kind: "feature",
      body: "Build a maze and **share** it.",
      version: "v1.3",
      images: [shot, theirs, "not-an-id"],
      links: [
        {
          kind: "website",
          url: "https://tiltmaze.app/editor",
          preview: { title: "Level editor", description: "Make mazes.", siteName: "TiltMaze", imageId: card },
        },
        { kind: "source", url: "https://github.com/you/tiltmaze", preview: null },
      ],
      details: { kind: "feature", name: "Level editor" },
    });

    const [update] = (await slopPage(setupResult)).updates;
    expect(update).toMatchObject({
      kind: "feature",
      html: expect.stringContaining("<strong>share</strong>"),
      version: "v1.3",
      images: [`${MEDIA_URL}/screenshots/editor.png`],
      links: [
        {
          kind: "website",
          url: "https://tiltmaze.app/editor",
          preview: {
            title: "Level editor",
            description: "Make mazes.",
            siteName: "TiltMaze",
            image: `${MEDIA_URL}/screenshots/card.png`,
          },
        },
        { kind: "source", url: "https://github.com/you/tiltmaze", preview: null },
      ],
      details: { kind: "feature", name: "Level editor" },
    });
    // Media ids never leave Convex.
    expect(JSON.stringify(update)).not.toContain(card);
  });

  it("drops a card image someone else uploaded, keeping the card's text", async () => {
    const setupResult = setup();
    const owner = await makeUser(setupResult, "maker");
    const stranger = await makeUser(setupResult, "stranger");
    const slopId = await ship(setupResult, owner);
    const theirs = await image(setupResult, stranger, "screenshots/theirs.png");
    await addUpdate(setupResult, {
      userId: owner,
      slopId,
      kind: "update",
      body: "Notes are up.",
      links: [
        {
          kind: "other",
          url: "https://blog.test/notes",
          preview: { title: "Notes", description: "", siteName: "blog.test", imageId: theirs },
        },
      ],
    });
    const [update] = (await slopPage(setupResult)).updates;
    expect(update.links[0].preview).toEqual({ title: "Notes", description: "", siteName: "blog.test", image: null });
  });

  it("refuses details meant for another kind of update", async () => {
    const setupResult = setup();
    const owner = await makeUser(setupResult, "maker");
    const slopId = await ship(setupResult, owner);
    await expect(
      addUpdate(setupResult, {
        userId: owner,
        slopId,
        kind: "update",
        body: "Fixed it.",
        details: { kind: "field", outcome: "worked", who: null },
      }),
    ).rejects.toThrow("Those details are for a field update.");
  });

  it("blurs the slop when an update shows a mature image", async () => {
    const setupResult = setup();
    const { server } = setupResult;
    const owner = await makeUser(setupResult, "maker");
    const slopId = await ship(setupResult, owner);
    const mature = await image(setupResult, owner, "screenshots/gore.png", "mature");
    await addUpdate(setupResult, {
      userId: owner,
      slopId,
      kind: "update",
      body: "New boss.",
      images: [mature],
    });
    expect(await server.query(api.slops.getForServer, { slopId })).toMatchObject({
      nsfw: true,
      check: { verdict: "mature", reason: "A screenshot: Looks mature." },
    });
  });
});

describe("letting go of update images", () => {
  it("removes a card and its image, and keeps the link", async () => {
    const setupResult = setup();
    const { server } = setupResult;
    const owner = await makeUser(setupResult, "maker");
    const slopId = await ship(setupResult, owner);
    const card = await image(setupResult, owner, "screenshots/card.png");
    const updateId = await addUpdate(setupResult, {
      userId: owner,
      slopId,
      kind: "update",
      body: "Notes are up.",
      links: [
        {
          kind: "other",
          url: "https://blog.test/notes",
          preview: { title: "Notes", description: "", siteName: "blog.test", imageId: card },
        },
      ],
    });

    const stranger = await makeUser(setupResult, "stranger");
    await expect(
      server.mutation(api.activity.removePreview, { userId: stranger, updateId, url: "https://blog.test/notes" }),
    ).rejects.toThrow("That update isn't yours.");

    const removed = await server.mutation(api.activity.removePreview, {
      userId: owner,
      updateId,
      url: "https://blog.test/notes",
    });
    expect(removed).toEqual({ orphaned: 1 });
    const [update] = (await slopPage(setupResult)).updates;
    expect(update.links).toEqual([{ kind: "other", url: "https://blog.test/notes", preview: null }]);
    expect(await server.query(api.media.orphans, { limit: 10 })).toEqual([{ id: card, key: "screenshots/card.png" }]);
    // Removing it again is a no-op.
    expect(
      await server.mutation(api.activity.removePreview, { userId: owner, updateId, url: "https://blog.test/notes" }),
    ).toEqual({ orphaned: 0 });
  });

  it("releases an update's images when it's deleted, unless the slop still shows them", async () => {
    const setupResult = setup();
    const { server } = setupResult;
    const owner = await makeUser(setupResult, "maker");
    const cover = await image(setupResult, owner, "screenshots/cover.png");
    const shot = await image(setupResult, owner, "screenshots/shot.png");
    const slopId = await ship(setupResult, owner, [cover]);
    const updateId = await addUpdate(setupResult, {
      userId: owner,
      slopId,
      kind: "update",
      body: "Before and after.",
      images: [cover, shot],
    });

    expect(await server.mutation(api.activity.deleteUpdate, { userId: owner, updateId })).toEqual({ orphaned: 1 });
    expect(await server.query(api.media.orphans, { limit: 10 })).toEqual([{ id: shot, key: "screenshots/shot.png" }]);
    expect(await server.query(api.media.url, { mediaId: cover })).toBe(`${MEDIA_URL}/screenshots/cover.png`);
  });

  it("keeps an image another update shows, and releases update images with the slop", async () => {
    const setupResult = setup();
    const { server } = setupResult;
    const owner = await makeUser(setupResult, "maker");
    const shot = await image(setupResult, owner, "screenshots/shot.png");
    const slopId = await ship(setupResult, owner);
    const post = (body: string) =>
      addUpdate(setupResult, { userId: owner, slopId, kind: "update", body, images: [shot] });
    const first = await post("One.");
    await post("Two.");

    expect(await server.mutation(api.activity.deleteUpdate, { userId: owner, updateId: first })).toEqual({
      orphaned: 0,
    });
    expect(await server.mutation(api.slops.remove, { slopId, byUserId: owner })).toEqual({
      orphaned: 1,
    });
  });
});

/** The app server's line to Convex, answered by convex-test. */
function caller({ server }: Setup): ConvexCaller {
  return {
    query: async (query, ...args) => await server.query<FunctionReference<"query">>(query, ...args),
    mutation: async (mutation, ...args) => await server.mutation<FunctionReference<"mutation">>(mutation, ...args),
  };
}

describe("update attempt quota", () => {
  const update: UpdateForm = {
    kind: "update",
    body: "Release notes.",
    version: null,
    images: [],
    links: [{ kind: "website", url: "https://example.com/notes", preview: true }],
    details: null,
  };

  it("does no preview work once the maker's daily quota is spent", async () => {
    const app = setup();
    const owner = await makeUser(app, "maker");
    const slopId = await ship(app, owner);
    vi.spyOn(convex, "mutation").mockImplementation(caller(app).mutation);
    const preview = vi.fn(async () => null);

    for (let i = 0; i < 30; i++) await postUpdate(owner, slopId, update, preview);

    preview.mockClear();
    await expect(postUpdate(owner, slopId, update, preview)).rejects.toThrow("Slow down");
    expect(preview).not.toHaveBeenCalled();
    expect((await slopPage(app)).updates.filter((entry) => entry.kind !== "launch")).toHaveLength(30);
  });

  it("checks ownership before doing preview work", async () => {
    const app = setup();
    const owner = await makeUser(app, "maker");
    const stranger = await makeUser(app, "stranger");
    const slopId = await ship(app, owner);
    vi.spyOn(convex, "mutation").mockImplementation(caller(app).mutation);
    const preview = vi.fn(async () => null);

    await expect(postUpdate(stranger, slopId, update, preview)).rejects.toThrow("That slop isn't yours.");
    expect(preview).not.toHaveBeenCalled();
  });

  it("charges attempts whose previews fail without saving an update", async () => {
    const app = setup();
    const owner = await makeUser(app, "maker");
    const slopId = await ship(app, owner);
    vi.spyOn(convex, "mutation").mockImplementation(caller(app).mutation);
    const preview = vi.fn(async () => {
      throw new Error("Preview processing failed.");
    });

    for (let i = 0; i < 30; i++) {
      await expect(postUpdate(owner, slopId, update, preview)).rejects.toThrow("Preview processing failed.");
    }

    preview.mockClear();
    await expect(postUpdate(owner, slopId, update, preview)).rejects.toThrow("Slow down");
    expect(preview).not.toHaveBeenCalled();
    expect((await slopPage(app)).updates.filter((entry) => entry.kind !== "launch")).toHaveLength(0);
  });

  it("keeps the charge when the final write is rejected", async () => {
    const app = setup();
    const owner = await makeUser(app, "maker");
    const slopId = await ship(app, owner);
    vi.spyOn(convex, "mutation").mockImplementation(caller(app).mutation);
    const preview = vi.fn(async () => null);

    await expect(
      postUpdate(owner, slopId, { ...update, details: { kind: "field", outcome: "worked", who: null } }, preview),
    ).rejects.toThrow("Those details are for a field update.");

    expect(preview).toHaveBeenCalledOnce();
    const charges = await app.t.run(async (ctx) => await ctx.db.query("rateLimits").collect());
    expect(charges.find((row) => row.key === `update:${owner}`)?.count).toBe(1);
    expect((await slopPage(app)).updates.filter((entry) => entry.kind !== "launch")).toHaveLength(0);
  });
});

describe("update reservations", () => {
  it("requires the server to reserve and post, and binds a reservation to its maker and slop", async () => {
    const app = setup();
    const owner = await makeUser(app, "maker");
    const stranger = await makeUser(app, "stranger");
    const slopId = await ship(app, owner);
    const otherSlop = await ship(app, owner);
    const theirs = await ship(app, stranger);
    const reservationId = await app.server.mutation(api.activity.reserveUpdate, { userId: owner, slopId });
    const args = { reservationId, userId: owner, slopId, kind: "update", body: "Notes." } as const;

    await expect(app.t.mutation(api.activity.reserveUpdate, { userId: owner, slopId })).rejects.toThrow();
    await expect(app.t.withIdentity({ subject: owner }).mutation(api.activity.addUpdate, args)).rejects.toThrow();
    await expect(app.server.mutation(api.activity.addUpdate, { ...args, slopId: otherSlop })).rejects.toThrow(
      "Reserve an update before posting it.",
    );
    await expect(
      app.server.mutation(api.activity.addUpdate, { ...args, userId: stranger, slopId: theirs }),
    ).rejects.toThrow("Reserve an update before posting it.");
  });

  it("retries the final write without creating another update or spending more quota", async () => {
    const app = setup();
    const owner = await makeUser(app, "maker");
    const slopId = await ship(app, owner);
    const reservationId = await app.server.mutation(api.activity.reserveUpdate, { userId: owner, slopId });
    const args = { reservationId, userId: owner, slopId, kind: "field", body: "Tried it." } as const;
    const first = await app.server.mutation(api.activity.addUpdate, args);

    expect(await app.server.mutation(api.activity.addUpdate, args)).toBe(first);
    expect(await app.server.query(api.slops.getForServer, { slopId })).toMatchObject({ updateCount: 2, fieldTests: 1 });
    const charges = await app.t.run(async (ctx) => await ctx.db.query("rateLimits").collect());
    expect(charges.find((row) => row.key === `update:${owner}`)?.count).toBe(1);
  });

  it("refuses expired reservations and sweeps them without refunding the attempt", async () => {
    const app = setup();
    const owner = await makeUser(app, "maker");
    const slopId = await ship(app, owner);
    const reservationId = await app.server.mutation(api.activity.reserveUpdate, { userId: owner, slopId });
    await app.t.run(async (ctx) => await ctx.db.patch(reservationId, { expiresAt: Date.now() - 1 }));

    await expect(
      app.server.mutation(api.activity.addUpdate, {
        reservationId,
        userId: owner,
        slopId,
        kind: "update",
        body: "Notes.",
      }),
    ).rejects.toThrow("That update attempt expired.");

    await app.t.mutation(internal.crons.sweep, {});
    expect(await app.t.run(async (ctx) => await ctx.db.get(reservationId))).toBeNull();
    const charges = await app.t.run(async (ctx) => await ctx.db.query("rateLimits").collect());
    expect(charges.find((row) => row.key === `update:${owner}`)?.count).toBe(1);
  });
});

class MemoryBucket implements MediaStore {
  readonly backend = "b2";
  readonly objects = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array<ArrayBuffer>, _contentType: string, kind: MediaKind): Promise<MediaLocation> {
    const key = `${kind}s/${this.objects.size + 1}.png`;
    this.objects.set(key, bytes);
    return { backend: "b2", key };
  }
}

function page(url: string, html: string): Fetched {
  return { url: new URL(url), contentType: "text/html", charset: "utf-8", bytes: new TextEncoder().encode(html) };
}

describe("link cards", () => {
  it("keeps a checked copy of the page's image, so the card never hotlinks it", async () => {
    const setupResult = setup();
    const owner = await makeUser(setupResult, "maker");
    const bucket = new MemoryBucket();
    const requested: string[] = [];
    const services: PreviewServices = {
      fetch: async (url) => {
        requested.push(url.href);
        if (url.pathname === "/og.png") {
          return { url, contentType: "image/png", charset: null, bytes: new Uint8Array(PNG) };
        }
        return page(
          "https://tiltmaze.app/editor",
          `<head><meta property="og:title" content="Level editor"><meta property="og:image" content="/og.png"></head>`,
        );
      },
      upload: (ownerId, bytes) =>
        uploadImage(
          ownerId,
          { bytes },
          { store: bucket, convex: caller(setupResult), contentCheck: null, fetcher: fetch },
        ),
    };

    const card = await linkPreview(owner, "https://tiltmaze.app/editor", services);
    expect(requested).toEqual(["https://tiltmaze.app/editor", "https://tiltmaze.app/og.png"]);
    expect(card).toMatchObject({ title: "Level editor", description: "", siteName: "tiltmaze.app" });
    expect(bucket.objects.get("screenshots/1.png")).toEqual(PNG);
    const media = await setupResult.t.run(async (ctx) => (card?.imageId ? await ctx.db.get(card.imageId) : null));
    expect(media).toMatchObject({ ownerId: owner, check: { verdict: "unchecked" } });
  });

  it("shows no card for a page it can't read, and a card without an image when the image fails", async () => {
    const setupResult = setup();
    const owner = await makeUser(setupResult, "maker");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const upload = vi.fn<PreviewServices["upload"]>();

    const down: PreviewServices = {
      fetch: async () => {
        throw new Error("tiltmaze.app answered 500.");
      },
      upload,
    };
    expect(await linkPreview(owner, "https://tiltmaze.app/", down)).toBeNull();

    const notHtml: PreviewServices = {
      fetch: async (url) => ({ url, contentType: "application/pdf", charset: null, bytes: new Uint8Array() }),
      upload,
    };
    expect(await linkPreview(owner, "https://tiltmaze.app/manual.pdf", notHtml)).toBeNull();

    const brokenImage: PreviewServices = {
      fetch: async (url) => {
        if (url.pathname === "/og.png") throw new Error("It's bigger than 4194304 bytes.");
        return page("https://tiltmaze.app/", `<title>TiltMaze</title><meta property="og:image" content="/og.png">`);
      },
      upload,
    };
    expect(await linkPreview(owner, "https://tiltmaze.app/", brokenImage)).toEqual({
      title: "TiltMaze",
      description: "",
      siteName: "tiltmaze.app",
      imageId: null,
    });
    expect(upload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
