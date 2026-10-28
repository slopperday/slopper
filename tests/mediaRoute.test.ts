// @vitest-environment edge-runtime
import type { FunctionReference } from "convex/server";
import { RouterContextProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import { convex, type ConvexCaller } from "~/.server/convex";
import { viewerContext } from "~/.server/session";
import { action } from "~/routes/api.media";
import { convexApp } from "./convexApp";

afterEach(() => vi.restoreAllMocks());

/** Runs the browser upload action against the real Convex mutations in memory. */
async function setup() {
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const t = convexApp();
  const server = t.withIdentity({ subject: "server" });
  const mutation: ConvexCaller["mutation"] = async (reference, ...args) =>
    await server.mutation<FunctionReference<"mutation">>(reference, ...args);
  const calls = vi.spyOn(convex, "mutation").mockImplementation(mutation);
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: "writer",
    preferredUsername: "writer",
    displayName: "Writer",
    avatarUrl: null,
    timeZone: "UTC",
  });
  const user = await t.run(async (ctx) => await ctx.db.get(userId));
  const context = new RouterContextProvider();
  context.set(viewerContext, { user, timeZone: "UTC", flash: null });
  const send = (request: Request) =>
    action({ request, context, params: {}, url: new URL(request.url), pattern: "/api/media" });
  return { t, server, userId, context, calls, send };
}

function request(body: FormData | string = new FormData(), address = "192.0.2.1") {
  return new Request("https://slopper.test/api/media", {
    method: "POST",
    headers: { "x-nf-client-connection-ip": address },
    body,
  });
}

describe("browser upload attempts", () => {
  it("requires sign-in before reading a body or spending a quota", async () => {
    const { t, context, send } = await setup();
    context.set(viewerContext, { user: null, timeZone: "UTC", flash: null });
    const input = request();
    const read = vi.spyOn(input, "formData");

    expect((await send(input)).init?.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(await t.run(async (ctx) => await ctx.db.query("rateLimits").collect())).toEqual([]);
  });

  it("charges missing-file attempts and refuses the next body at the account limit, across addresses", async () => {
    const { send } = await setup();

    for (let attempt = 0; attempt < 60; attempt++) {
      expect((await send(request())).init?.status).toBe(400);
    }

    const input = request(new FormData(), "192.0.2.2");
    const read = vi.spyOn(input, "formData");
    expect((await send(input)).init?.status).toBe(429);
    expect(read).not.toHaveBeenCalled();
  });

  it("charges a malformed multipart body even when parsing throws", async () => {
    const { t, userId, send } = await setup();
    const input = request("broken multipart");
    input.headers.set("content-type", "multipart/form-data; boundary=missing");

    await expect(send(input)).rejects.toThrow();
    const rows = await t.run(async (ctx) => await ctx.db.query("rateLimits").collect());
    expect(rows.find((row) => row.key === `media-body:user:${userId}`)?.count).toBe(1);
  });

  it("refuses an exhausted address before reading file bytes, even for a fresh account", async () => {
    const { server, send } = await setup();

    for (let attempt = 0; attempt < 120; attempt++) {
      await server.mutation(api.limits.hit, { key: "media-body:ip:192.0.2.1", limit: 120, windowMs: 3_600_000 });
    }

    const form = new FormData();
    const file = new File(["%PDF-1.7"], "book.pdf");
    const bytes = vi.spyOn(File.prototype, "arrayBuffer");
    form.set("file", file);
    form.set("kind", "publication");
    const input = request(form);
    const read = vi.spyOn(input, "formData");

    expect((await send(input)).init?.status).toBe(429);
    expect(read).not.toHaveBeenCalled();
    expect(bytes).not.toHaveBeenCalled();
  });

  it("fails closed before reading the body when the quota service is unavailable", async () => {
    const { calls, send } = await setup();
    calls.mockRejectedValueOnce(new Error("Convex unavailable"));
    const input = request();
    const read = vi.spyOn(input, "formData");

    await expect(send(input)).rejects.toThrow("Convex unavailable");
    expect(read).not.toHaveBeenCalled();
  });
});
