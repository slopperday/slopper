// @vitest-environment edge-runtime
import type { FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ConvexCaller } from "~/.server/convex";
import { encodeBase64 } from "~/.server/encoding";
import { validateSlop } from "~/.server/forms";
import {
  BLOCKED_PUBLICATION,
  publicationFileName,
  sniffPdf,
  type UploadServices,
  uploadImage,
  uploadPublication,
} from "~/.server/media";
import { checkedContent, publicationSubmission } from "~/.server/moderation";
import type { MediaKind, MediaLocation, MediaStore } from "~/.server/storage";
import { fileSize } from "~/lib/display";
import { LIMITS } from "~/lib/model";
import { convexApp } from "./convexApp";

const MEDIA_URL = "https://media.test/file/slopper-media";
const CHECK = {
  apiKey: "key",
  baseUrl: "https://openrouter.test/api/v1",
  model: "deepseek/deepseek-v4.1-flash",
  provider: "deepseek",
};
/** A PDF header is all the sniffing needs. */
const PDF = new Uint8Array([...new TextEncoder().encode("%PDF-1.7\n"), 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup() {
  vi.stubEnv("MEDIA_PUBLIC_URL", `${MEDIA_URL}/`);
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Server = ReturnType<typeof setup>["server"];

/** The app server's line to Convex, answered by convex-test (see tests/media.test.ts). */
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

/** A bucket that keeps what it's given, in memory, under the folder and extension a real one would use. */
class MemoryBucket implements MediaStore {
  readonly backend = "b2";
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(bytes: Uint8Array<ArrayBuffer>, contentType: string, kind: MediaKind): Promise<MediaLocation> {
    const key = `${kind}s/${this.objects.size + 1}.${contentType === "application/pdf" ? "pdf" : "png"}`;
    this.objects.set(key, { bytes, contentType });
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

function services(server: Server, store: MediaStore, fetcher: typeof fetch): UploadServices {
  return { store, convex: caller(server), contentCheck: CHECK, fetcher };
}

function guideInput(publication: string | null, links: { kind: "website"; url: string }[] = []) {
  return {
    name: "Field guide",
    tagline: "How to ship every day",
    description: "",
    category: "learning",
    links,
    screenshots: [],
    publication,
    madeWith: [],
  };
}

async function upload(
  server: Server,
  owner: Id<"users">,
  verdict: "ok" | "mature" = "ok",
  bucket = new MemoryBucket(),
) {
  const result = await uploadPublication(
    owner,
    { bytes: PDF, fileName: "C:\\Users\\me\\Field Guide.PDF" },
    services(server, bucket, contentCheck(verdict).fetcher),
  );
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function launch(server: Server, owner: Id<"users">, publication: string | null) {
  return await server.mutation(api.slops.create, {
    userId: owner,
    input: guideInput(publication),
    launchNote: "Day 1",
  });
}

describe("publication uploads", () => {
  it("checks the PDF's text, then stores it with its name", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "writer");
    const bucket = new MemoryBucket();
    const check = contentCheck("ok");
    const result = await uploadPublication(
      owner,
      { bytes: PDF, fileName: "C:\\Users\\me\\Field Guide.PDF" },
      services(server, bucket, check.fetcher),
    );
    expect(result).toMatchObject({
      ok: true,
      fileName: "Field Guide.pdf",
      contentCheck: "ok",
      url: `${MEDIA_URL}/publications/1.pdf`,
    });
    expect(bucket.objects.get("publications/1.pdf")).toEqual({ bytes: PDF, contentType: "application/pdf" });
    const [row] = await t.run(async (ctx) => await ctx.db.query("media").collect());
    expect(row).toMatchObject({ contentType: "application/pdf", fileName: "Field Guide.pdf", size: PDF.byteLength });

    // The PDF goes inline, for OpenRouter to read its text out.
    const body = JSON.parse(check.bodies[0]) as {
      messages: { content: unknown }[];
      plugins: unknown;
    };
    expect(body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "pdf-text" } }]);
    expect(body.messages[1].content).toEqual([
      { type: "text", text: JSON.stringify({ upload: "publication", fileName: "Field Guide.pdf" }) },
      {
        type: "file",
        file: { filename: "Field Guide.pdf", file_data: `data:application/pdf;base64,${encodeBase64(PDF)}` },
      },
    ]);
  });

  it("refuses a blocked PDF before anything is stored", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "writer");
    const bucket = new MemoryBucket();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await uploadPublication(
      owner,
      { bytes: PDF, fileName: "nope.pdf" },
      services(server, bucket, contentCheck("blocked").fetcher),
    );
    expect(result).toEqual({ ok: false, error: BLOCKED_PUBLICATION });
    expect(bucket.objects.size).toBe(0);
    expect(await t.run(async (ctx) => await ctx.db.query("media").collect())).toEqual([]);
  });

  it("stores one as unchecked when the check is down", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "writer");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await uploadPublication(
      owner,
      { bytes: PDF },
      services(server, new MemoryBucket(), contentCheck(null).fetcher),
    );
    expect(result).toMatchObject({ ok: true, contentCheck: "unchecked", fileName: "publication.pdf" });
  });

  it("sniffs the type and caps the size", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "writer");
    const check = contentCheck("ok");
    const send = (bytes: Uint8Array<ArrayBuffer>) =>
      uploadPublication(owner, { bytes }, services(server, new MemoryBucket(), check.fetcher));
    expect(await send(PNG)).toEqual({ ok: false, error: "Use a PDF." });
    expect(await send(new Uint8Array())).toEqual({ ok: false, error: "Empty file." });
    const huge = new Uint8Array(LIMITS.publicationBytes + 1);
    huge.set(PDF);
    expect(await send(huge)).toEqual({ ok: false, error: "PDFs must be 4 MB or smaller." });
    expect(check.bodies).toEqual([]);
  });

  it("reads a PDF header after a little junk, as readers do", () => {
    expect(sniffPdf(new Uint8Array([0xef, 0xbb, 0xbf, ...PDF]))).toBe(true);
    expect(sniffPdf(PNG)).toBe(false);
  });

  it("names files fit to show", () => {
    expect(publicationFileName("/home/me/zine.pdf")).toBe("zine.pdf");
    expect(publicationFileName("notes")).toBe("notes.pdf");
    expect(publicationFileName("  .pdf ")).toBe("publication.pdf");
    expect(publicationFileName(null)).toBe("publication.pdf");
    expect(publicationFileName("bad\u0000name.pdf")).toBe("badname.pdf");
    expect(publicationFileName(`${"a".repeat(300)}.pdf`)).toHaveLength(LIMITS.publicationNameLength);
  });
});

describe("slops with a publication", () => {
  it("launch with no links, show the PDF on the page and in the check", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "writer");
    const pdf = await upload(server, owner);
    const { slopId } = await launch(server, owner, pdf.id);

    const page = await server.query(api.slops.page, { username: "writer", slug: "field-guide" });
    expect(page?.slop).toMatchObject({
      links: [],
      publication: { url: `${MEDIA_URL}/publications/1.pdf`, fileName: "Field Guide.pdf", size: PDF.byteLength },
    });
    const stored = await server.query(api.slops.getForServer, { slopId });
    if (!stored) throw new Error("No slop.");
    // Changing the PDF counts as a change the launch check reads.
    expect(checkedContent(stored)).not.toBe(checkedContent({ ...stored, publication: undefined }));
  });

  it("blur the slop when the PDF was mature", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "writer");
    const pdf = await upload(server, owner, "mature");
    const { slopId, blurred } = await launch(server, owner, pdf.id);
    expect(blurred).toBe(true);
    expect(await server.query(api.slops.getForServer, { slopId })).toMatchObject({
      nsfw: true,
      check: { verdict: "mature", reason: "The PDF: Looks mature." },
    });
  });

  it("only take the maker's own PDFs, and never a PDF as a screenshot or an image as the PDF", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "writer");
    const other = await makeUser(server, "other");
    const theirs = await upload(server, other);
    await expect(launch(server, owner, theirs.id)).rejects.toThrow("That isn't one of your uploaded PDFs.");

    const image = await uploadImage(
      owner,
      { bytes: PNG },
      services(server, new MemoryBucket(), contentCheck("ok").fetcher),
    );
    if (!image.ok) throw new Error(image.error);
    await expect(launch(server, owner, image.id)).rejects.toThrow("That isn't one of your uploaded PDFs.");

    const mine = await upload(server, owner);
    const { slopId } = await server.mutation(api.slops.create, {
      userId: owner,
      input: { ...guideInput(mine.id), screenshots: [mine.id, image.id] },
      launchNote: "Day 1",
    });
    const stored = await server.query(api.slops.getForServer, { slopId });
    expect(stored?.screenshots).toEqual([image.id]);
    expect(stored?.publication).toBe(mine.id);
  });

  it("keep the PDF on edits that leave it out, and let it go when it's taken off or the slop is deleted", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "writer");
    const pdf = await upload(server, owner);
    const { slopId } = await launch(server, owner, pdf.id);
    const link = [{ kind: "website" as const, url: "https://guide.example/" }];

    const { publication: _left, ...withoutPublication } = guideInput(null, link);
    await server.mutation(api.slops.edit, { userId: owner, slopId, input: withoutPublication });
    expect((await server.query(api.slops.getForServer, { slopId }))?.publication).toBe(pdf.id);

    expect(await server.mutation(api.slops.edit, { userId: owner, slopId, input: guideInput(null, link) })).toEqual({
      blurred: false,
      orphaned: 1,
    });
    expect((await server.query(api.slops.getForServer, { slopId }))?.publication).toBeUndefined();
    expect((await t.run(async (ctx) => await ctx.db.get(pdf.id)))?.orphanedAt).toEqual(expect.any(Number));

    const next = await upload(server, owner);
    const second = await launch(server, owner, next.id);
    expect(await server.mutation(api.slops.remove, { slopId: second.slopId, byUserId: owner })).toEqual({
      orphaned: 1,
    });
  });

  it("carry the PDF on a scheduled launch, and a relaunch can keep it", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "writer");
    const pdf = await upload(server, owner);
    const first = await launch(server, owner, pdf.id);

    const queued = await server.mutation(api.schedule.add, {
      userId: owner,
      input: guideInput(pdf.id),
      launchNote: "Second edition",
      when: { kind: "next" },
      autopost: false,
      relaunchOf: first.slopId,
      launchLabel: "2nd edition",
    });
    const out = await server.mutation(api.schedule.releaseNow, { userId: owner, id: queued.id });
    expect((await server.query(api.slops.getForServer, { slopId: out.slopId }))?.publication).toBe(pdf.id);
  });
});

describe("validation", () => {
  const base = { name: "Field guide", tagline: "How to ship", category: "learning" };

  it("needs a link or a publication", () => {
    expect(validateSlop({ ...base, links: [] })).toMatchObject({
      ok: false,
      errors: { links: "Add at least one link so people can try it, or upload a PDF." },
    });
    expect(validateSlop({ ...base, links: [], publication: "k57abcdefghijklmnop" })).toMatchObject({
      ok: true,
      value: { links: [], publication: "k57abcdefghijklmnop" },
    });
    expect(validateSlop({ ...base, links: [{ url: "https://guide.example" }] })).toMatchObject({
      ok: true,
      value: { publication: null },
    });
    expect(validateSlop({ ...base, publication: "not an id!" })).toMatchObject({
      ok: false,
      errors: { publication: "That PDF didn't upload. Try it again." },
    });
  });

  it("says what the check reads", () => {
    expect(publicationSubmission({ bytes: PDF, fileName: "zine.pdf" }).fields).toEqual({
      upload: "publication",
      fileName: "zine.pdf",
    });
    expect(fileSize(340 * 1024)).toBe("340 KB");
    expect(fileSize(2.44 * 1024 * 1024)).toBe("2.4 MB");
  });
});
