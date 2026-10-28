import { RouterContextProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convexApp } from "./convexApp";
import { checkedLaunch } from "./launchFixtures";

const { query, mutation } = vi.hoisted(() => ({
  query: vi.fn<ReturnType<typeof convexApp>["query"]>(),
  mutation: vi.fn<ReturnType<typeof convexApp>["mutation"]>(),
}));
vi.mock("~/.server/convex", () => ({ convex: { query, mutation } }));

const { action } = await import("~/routes/api.traction");
const NOW = 1_800_000_000_000;

/** Runs the real route and rate limiter against an isolated Convex database. */
function setup() {
  const t = convexApp();
  const server = t.withIdentity({ subject: "server" });
  query.mockImplementation(server.query);
  mutation.mockImplementation(server.mutation);

  return { t, server };
}

/** A visitor's POST; the platform's address header is the trusted bucket key. */
function refresh(id: string, address = "192.0.2.1", context = new RouterContextProvider(), force = false) {
  const request = new Request(`https://slopper.day/api/slops/${id}/traction`, {
    method: "POST",
    headers: { "x-nf-client-connection-ip": address },
    body: new URLSearchParams({ force: force ? "1" : "0" }),
  });

  return action({ request, params: { id }, context, url: new URL(request.url), pattern: "/api/slops/:id/traction" });
}

beforeEach(() => {
  query.mockReset();
  mutation.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => vi.restoreAllMocks());

describe("traction refresh admission", () => {
  it("caps an address across slop ids before any lookup or claim, then allows the next minute", async () => {
    const { t } = setup();
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", { key: "traction:192.0.2.1", window: Math.floor(NOW / 60_000), count: 59 }),
    );
    expect(await refresh("missing")).toMatchObject({ init: { status: 404 } });

    query.mockClear();
    mutation.mockClear();
    expect(await refresh("another-id")).toMatchObject({
      data: { synced: 0 },
      init: { status: 429 },
    });
    expect(query).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledExactlyOnceWith(api.limits.hit, {
      key: "traction:192.0.2.1",
      limit: 60,
      windowMs: 60_000,
    });

    expect(await refresh("missing", "192.0.2.2")).toMatchObject({ init: { status: 404 } });
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    expect(await refresh("missing")).toMatchObject({ init: { status: 404 } });
  });

  it("fails closed when the limiter is unavailable, without querying or claiming", async () => {
    setup();
    mutation.mockRejectedValueOnce(new Error("Convex is down"));

    await expect(refresh("missing")).rejects.toThrow("Convex is down");
    expect(query).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledExactlyOnceWith(api.limits.hit, {
      key: "traction:192.0.2.1",
      limit: 60,
      windowMs: 60_000,
    });
  });

  it("still refreshes public slops and lets only their owner force a sync", async () => {
    const { t, server } = setup();
    const { userId } = await server.mutation(api.users.upsertFromIdentity, {
      provider: "dev",
      providerId: "maker",
      preferredUsername: "maker",
      displayName: "Maker",
      avatarUrl: null,
      timeZone: "UTC",
    });
    const { slopId } = await checkedLaunch(server, {
      userId,
      input: {
        name: "TiltMaze",
        tagline: "Tilt to play",
        description: "",
        category: "games",
        links: [{ kind: "website", url: "https://example.com/" }],
        screenshots: [],
        madeWith: [],
      },
      launchNote: "Day 1",
    });

    expect(await refresh(slopId, "192.0.2.1", undefined, true)).toEqual({ synced: 0 });
    expect(mutation).toHaveBeenLastCalledWith(api.integrations.claim, { productId: slopId, force: false });

    const user = await t.run((ctx) => ctx.db.get(userId));
    const context = new RouterContextProvider();
    context.set(viewerContext, { user, timeZone: "UTC", flash: null });
    expect(await refresh(slopId, "192.0.2.1", context, true)).toEqual({ synced: 0 });
    expect(mutation).toHaveBeenLastCalledWith(api.integrations.claim, { productId: slopId, force: true });
  });
});
