// @vitest-environment edge-runtime
import { type FunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import { convex, type ConvexCaller } from "~/.server/convex";
import { config } from "~/.server/config";
import { findOperation, runOperation } from "~/.server/agent/operations";
import { convexApp } from "./convexApp";

const originalCheck = config.contentCheck;
afterEach(() => {
  config.contentCheck = originalCheck;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexApp();
  const server = t.withIdentity({ subject: "server" });
  const userId = (
    await server.mutation(api.users.upsertFromIdentity, {
      provider: "dev",
      providerId: "draft-maker",
      preferredUsername: "draft-maker",
      displayName: "Maker",
      avatarUrl: null,
      timeZone: "UTC",
    })
  ).userId;
  const otherId = (
    await server.mutation(api.users.upsertFromIdentity, {
      provider: "dev",
      providerId: "other",
      preferredUsername: "other",
      displayName: "Other",
      avatarUrl: null,
      timeZone: "UTC",
    })
  ).userId;
  const user = (await t.run((ctx) => ctx.db.get(userId)))!;
  const other = (await t.run((ctx) => ctx.db.get(otherId)))!;
  const caller: ConvexCaller = {
    query: async (query, ...args) => await server.query<FunctionReference<"query">>(query, ...args),
    mutation: async (mutation, ...args) => await server.mutation<FunctionReference<"mutation">>(mutation, ...args),
  };
  vi.spyOn(convex, "query").mockImplementation(caller.query);
  vi.spyOn(convex, "mutation").mockImplementation(caller.mutation);
  const connect = (provider: "x" | "bluesky", remoteId: string) =>
    server.mutation(api.accounts.connect, {
      userId,
      provider,
      remoteId,
      handle: remoteId,
      displayName: remoteId,
      avatarUrl: null,
      sealedCredentials: "secret",
      expiresAt: null,
    });
  const x = await connect("x", "brand1");
  const sky = await connect("bluesky", "brand2");
  const call = (name: string, input: object, actor = user) => {
    const operation = findOperation(name);
    if (!operation) throw new Error(`Missing ${name}`);
    return runOperation(operation, { user: actor, now: new Date() }, input);
  };
  return { server, userId, user, other, x, sky, call };
}

describe("agent social draft lifecycle", () => {
  it("edits a draft without sending, schedules all accounts after a content check, and cancels it", async () => {
    const { call, x, sky, other } = await setup();
    const draft = (await call("create_social_post", {
      text: "First",
      accounts: [x._id, sky._id],
      at: "draft",
      thread: ["Part two"],
      firstComment: "hello",
      perNetwork: { x: "X copy" },
    })) as { id: string; status: string };
    expect(draft.status).toBe("draft");
    await expect(call("edit_social_post", { post: draft.id, text: "Stolen" }, other)).rejects.toThrow("No such post");
    const edited = (await call("edit_social_post", { post: draft.id, text: "Revised" })) as {
      status: string;
      thread: string[];
      firstComment: string;
      perNetwork: Record<string, string>;
      copies: { accountId: string }[];
    };
    expect(edited.status).toBe("draft");
    expect(edited.thread).toEqual(["Part two"]);
    expect(edited.firstComment).toBe("hello");
    expect(edited.perNetwork).toEqual({ x: "X copy" });
    expect(edited.copies.map((row) => row.accountId)).toEqual(expect.arrayContaining([x._id, sky._id]));
    const at = new Date(Date.now() + 3_600_000).toISOString();
    config.contentCheck = null;
    await expect(call("edit_social_post", { post: draft.id, at })).rejects.toThrow("content check");
    config.contentCheck = { apiKey: "test", baseUrl: "https://model.test", model: "test", provider: "test" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: JSON.stringify({ verdict: "ok", reason: "fine" }) } }] }),
        ),
    );
    const scheduled = (await call("edit_social_post", { post: draft.id, at })) as {
      status: string;
      scheduledAt: string;
      copies: { status: string }[];
    };
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.scheduledAt).toBe(at);
    expect(scheduled.copies.map((copy) => copy.status)).toEqual(["queued", "queued"]);
    expect(await call("cancel_social_post", { post: draft.id })).toEqual({ id: draft.id, status: "cancelled" });
    await expect(call("edit_social_post", { post: draft.id, at })).rejects.toThrow("Only drafts");
  });

  it("accumulates account-specific copies and reports text and media problems before posting", async () => {
    const { call, x, sky, server, userId } = await setup();
    const youtube = await server.mutation(api.accounts.connect, {
      userId,
      provider: "youtube",
      remoteId: "channel",
      handle: "channel",
      displayName: "Channel",
      avatarUrl: null,
      sealedCredentials: "secret",
      expiresAt: null,
    });
    const draft = (await call("create_social_post", {
      text: "Draft",
      accounts: [x._id, sky._id, youtube._id],
      at: "draft",
    })) as { id: string };
    await call("edit_social_post", { post: draft.id, copy: { x: "X version", [sky._id]: "Sky version" } });
    const revised = (await call("edit_social_post", { post: draft.id, copy: { [x._id]: "A".repeat(300) } })) as {
      status: string;
      perNetwork: Record<string, string>;
      readiness: { copies: { accountId: string; text: string | null; warnings: string[] }[] };
    };
    expect(revised.status).toBe("draft");
    expect(revised.perNetwork).toEqual({ x: "X version", [sky._id]: "Sky version", [x._id]: "A".repeat(300) });
    const xPreview = revised.readiness.copies.find((entry) => entry.accountId === x._id)!;
    expect(xPreview.warnings.join(" ")).toContain("shortened");
    expect(xPreview.text).toContain("…");
    expect(revised.readiness.copies.find((entry) => entry.accountId === sky._id)?.text).toBe("Sky version");
    expect(revised.readiness.copies.find((entry) => entry.accountId === youtube._id)?.warnings.join(" ")).toContain(
      "needs a video",
    );
    expect(revised.readiness.copies.find((entry) => entry.accountId === youtube._id)?.warnings.join(" ")).toContain(
      "title",
    );
    const withOptions = (await call("edit_social_post", {
      post: draft.id,
      options: {
        youtube: { title: "Product tour", privacy: "private", madeForKids: false },
        instagram: { format: "story" },
      },
    })) as {
      options: { youtube: { title: string }; instagram: { format: string } };
      readiness: { copies: { accountId: string; warnings: string[] }[] };
    };
    expect(withOptions.options.youtube.title).toBe("Product tour");
    expect(withOptions.options.instagram.format).toBe("story");
    expect(
      withOptions.readiness.copies.find((entry) => entry.accountId === youtube._id)?.warnings.join(" "),
    ).not.toContain("title");
    await expect(
      call("edit_social_post", {
        post: draft.id,
        options: { youtube: { title: "Bad", privacy: "everyone", madeForKids: false } },
      }),
    ).rejects.toThrow("Invalid YouTube privacy");
    await expect(call("edit_social_post", { post: draft.id, copy: { typo: "lost" } })).rejects.toThrow(
      "No selected account or network",
    );
    const cleared = (await call("edit_social_post", { post: draft.id, copy: { [x._id]: "" } })) as {
      readiness: { copies: { accountId: string; text: string | null }[] };
    };
    expect(cleared.readiness.copies.find((entry) => entry.accountId === x._id)?.text).toBe("X version");
  });

  it("deletes drafts and refuses unavailable destination accounts without changing the draft", async () => {
    const { call, x } = await setup();
    const draft = (await call("create_social_post", { text: "Draft", accounts: [x._id], at: "draft" })) as {
      id: string;
    };
    await expect(call("edit_social_post", { post: draft.id, accounts: [x._id, "unknown"] })).rejects.toThrow(
      "isn't available",
    );
    expect(await call("cancel_social_post", { post: draft.id })).toEqual({ id: draft.id, status: "deleted" });
    await expect(call("get_social_post", { post: draft.id })).rejects.toThrow("No such post");
  });
});
