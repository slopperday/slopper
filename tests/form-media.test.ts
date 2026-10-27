// @vitest-environment edge-runtime
import type { FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convex, type ConvexCaller } from "~/.server/convex";
import { publicationForForm, screenshotsWithUrls } from "~/.server/media";
import { convexApp } from "./convexApp";

const MEDIA_URL = "https://media.test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Uses the real Convex queries behind the app server's transport. */
async function setup() {
  vi.stubEnv("MEDIA_PUBLIC_URL", MEDIA_URL);
  const t = convexApp();
  const server = t.withIdentity({ subject: "server" });
  const query: ConvexCaller["query"] = async (ref, ...args) =>
    await server.query<FunctionReference<"query">>(ref, ...args);
  vi.spyOn(convex, "query").mockImplementation(query);
  const makeUser = async (name: string) =>
    (
      await server.mutation(api.users.upsertFromIdentity, {
        provider: "dev",
        providerId: name,
        preferredUsername: name,
        displayName: name,
        avatarUrl: null,
        timeZone: "UTC",
      })
    ).userId;
  const userId = await makeUser("maker");
  const otherId = await makeUser("other");
  const media = async (contentType: string, ownerId: Id<"users"> = userId) =>
    await server.mutation(api.media.register, {
      ownerId,
      location: { backend: "b2", key: `private/${ownerId}/${contentType}` },
      contentType,
      size: 123,
      check: { verdict: "ok", reason: "test" },
      fileName: "private.pdf",
    });
  return { t, server, userId, otherId, media };
}

describe("form media", () => {
  it("never resolves a pending video or publication as a screenshot", async () => {
    const { userId, media } = await setup();
    const video = await media("video/mp4");
    const publication = await media("application/pdf");
    expect(await screenshotsWithUrls(userId, [video.mediaId, publication.mediaId])).toEqual([]);
    expect(await publicationForForm(userId, video.mediaId)).toBeNull();
  });

  it("drops another owner's images, publications and unapproved videos without disclosing metadata", async () => {
    const { userId, otherId, media } = await setup();
    const ownImage = await media("image/png");
    const ownPublication = await media("application/epub+zip");
    const foreign = await Promise.all([
      media("image/png", otherId),
      media("application/pdf", otherId),
      media("video/mp4", otherId),
    ]);

    expect(await screenshotsWithUrls(userId, [ownImage.mediaId, ...foreign.map((row) => row.mediaId)])).toEqual([
      { id: ownImage.mediaId, url: ownImage.url },
    ]);

    for (const row of foreign) expect(await publicationForForm(userId, row.mediaId)).toBeNull();

    expect(await publicationForForm(userId, ownPublication.mediaId)).toMatchObject({
      id: ownPublication.mediaId,
      url: ownPublication.url,
      fileName: "private.pdf",
      format: "epub",
      size: 123,
    });
    expect(await publicationForForm(userId, ownImage.mediaId)).toBeNull();
  });

  it("drops malformed, wrong-table, deleted and orphaned ids", async () => {
    const { t, userId, media } = await setup();
    const deleted = await media("image/png");
    const orphaned = await media("application/pdf");
    await t.run(async (ctx) => {
      await ctx.db.delete(deleted.mediaId);
      await ctx.db.patch(orphaned.mediaId, { orphanedAt: Date.now() });
    });
    const invalid = ["not-an-id", userId, deleted.mediaId, orphaned.mediaId];

    expect(await screenshotsWithUrls(userId, invalid)).toEqual([]);

    for (const id of invalid) expect(await publicationForForm(userId, id)).toBeNull();

    expect(await publicationForForm(userId, null)).toBeNull();
  });

  it("requires server authentication even when an owner id is supplied", async () => {
    const { t, userId, media } = await setup();
    const image = await media("image/png");
    const publication = await media("application/pdf");

    for (const caller of [t, t.withIdentity({ subject: userId })]) {
      await expect(caller.query(api.media.imageForOwner, { ownerId: userId, mediaId: image.mediaId })).rejects.toThrow(
        "Only the Slopper server",
      );
      await expect(
        caller.query(api.media.publication, { ownerId: userId, mediaId: publication.mediaId }),
      ).rejects.toThrow("Only the Slopper server");
    }
  });
});
