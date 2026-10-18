// @vitest-environment edge-runtime
import { describe, expect, it } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { addDays } from "~/lib/dates";
import { SYNC_EVERY_MS, SYNC_LOCK_MS, TRACTION_DAYS } from "~/lib/integrations";
import { convexApp } from "./convexApp";

const today = new Date().toISOString().slice(0, 10);

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

type Setup = ReturnType<typeof setup>;
type Server = Setup["server"];
type Provider = "ga4" | "posthog" | "stripe" | "solana";

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

async function ship(
  server: Server,
  userId: Id<"users">,
  options: { relaunchOf?: Id<"slops">; launchLabel?: string } = {},
): Promise<Id<"slops">> {
  const { slopId } = await server.mutation(api.slops.create, {
    userId,
    input: {
      name: "TiltMaze",
      tagline: "Tilt to play",
      description: "",
      category: "games",
      links: [{ kind: "website", url: "https://tiltmaze.app/" }],
      screenshots: [],
      madeWith: [],
    },
    launchNote: "Day 1",
    today,
    ...options,
  });
  return slopId;
}

function connect(
  server: Server,
  userId: Id<"users">,
  slopId: Id<"slops">,
  provider: Provider,
  options: { settings?: Record<string, string>; public?: boolean } = {},
) {
  return server.mutation(api.integrations.connect, {
    userId,
    slopId,
    provider,
    settings: options.settings ?? {},
    sealedSecret: provider === "stripe" || provider === "posthog" ? "sealed-key" : null,
    public: options.public ?? true,
  });
}

function ok(
  days: { date: string; people?: number; signups?: number; revenue?: Record<string, number> }[],
  options: {
    merge?: "replace" | "add";
    live?: number | null;
    snapshot?: { mrr?: Record<string, number>; subscribers?: number; people30?: number };
    cursor?: string | null;
  } = {},
) {
  return {
    ok: true as const,
    merge: options.merge ?? "replace",
    days,
    live: options.live ?? null,
    snapshot: options.snapshot ?? {},
    cursor: options.cursor ?? null,
  };
}

function record(
  server: Server,
  integrationId: Id<"integrations">,
  outcome: ReturnType<typeof ok> | { ok: false; error: string },
) {
  return server.mutation(api.integrations.record, { integrationId, outcome });
}

const integrationRows = ({ t }: Setup) => t.run((ctx) => ctx.db.query("integrations").collect());
const metricRows = ({ t }: Setup) => t.run((ctx) => ctx.db.query("metrics").collect());

/** Backdates when a row last synced or started syncing. */
function patchTimes(
  { t }: Setup,
  id: Id<"integrations">,
  times: { syncedAt?: number | null; syncingAt?: number | null },
) {
  return t.run((ctx) => ctx.db.patch(id, times));
}

describe("connecting a source", () => {
  it("starts pending, with nothing synced", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    await connect(env.server, owner, slopId, "stripe", { settings: { keyEnding: "wxyz" } });

    const [row] = await integrationRows(env);
    expect(row).toMatchObject({
      provider: "stripe",
      productId: slopId,
      userId: owner,
      settings: { keyEnding: "wxyz" },
      sealedSecret: "sealed-key",
      public: true,
      status: "pending",
      error: null,
      syncedAt: null,
      syncingAt: null,
      cursor: null,
      live: null,
    });
  });

  it("replaces an existing source from the same provider, with its numbers", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    const first = await connect(env.server, owner, slopId, "stripe");
    const other = await connect(env.server, owner, slopId, "solana", { settings: { wallet: "w" } });
    await record(env.server, first, ok([{ date: today, revenue: { USD: 100 } }]));
    await record(env.server, other, ok([{ date: today, revenue: { USD: 5 } }], { merge: "add" }));

    const second = await connect(env.server, owner, slopId, "stripe", { settings: { keyEnding: "new1" } });

    expect(second).not.toBe(first);
    const rows = await integrationRows(env);
    expect(rows.map((row) => row._id).sort()).toEqual([other, second].sort());
    expect(rows.find((row) => row._id === second)).toMatchObject({ status: "pending", syncedAt: null });
    const metrics = await metricRows(env);
    expect(metrics.map((row) => row.integrationId)).toEqual([other]);
  });

  it("keys sources by the product's first launch", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const first = await ship(env.server, owner);
    const relaunch = await ship(env.server, owner, { relaunchOf: first, launchLabel: "iOS beta" });
    await connect(env.server, owner, relaunch, "ga4", { settings: { propertyId: "123456789" } });

    const [row] = await integrationRows(env);
    expect(row.productId).toBe(first);
  });

  it("only lets the owner connect", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const stranger = await makeUser(env.server, "stranger");
    const slopId = await ship(env.server, owner);

    await expect(connect(env.server, stranger, slopId, "stripe")).rejects.toThrow("That slop isn't yours.");
    expect(await integrationRows(env)).toEqual([]);
  });

  it("only takes calls from the app server", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    await expect(
      env.t.withIdentity({ subject: owner }).mutation(api.integrations.connect, {
        userId: owner,
        slopId,
        provider: "ga4",
        settings: {},
        sealedSecret: null,
        public: true,
      }),
    ).rejects.toThrow("Only the Slopper server");
  });

  it("only lets the owner disconnect or change visibility", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const stranger = await makeUser(env.server, "stranger");
    const slopId = await ship(env.server, owner);
    const id = await connect(env.server, owner, slopId, "stripe");

    await expect(
      env.server.mutation(api.integrations.disconnect, { userId: stranger, integrationId: id }),
    ).rejects.toThrow("That connection isn't yours.");
    await expect(
      env.server.mutation(api.integrations.setPublic, { userId: stranger, integrationId: id, public: false }),
    ).rejects.toThrow("That connection isn't yours.");
    await expect(
      env.server.mutation(api.integrations.disconnect, { userId: owner, integrationId: "not-an-id" }),
    ).rejects.toThrow("That connection isn't yours.");

    await env.server.mutation(api.integrations.setPublic, { userId: owner, integrationId: id, public: false });
    expect((await integrationRows(env))[0].public).toBe(false);
  });

  it("disconnecting removes the source and its numbers", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    const id = await connect(env.server, owner, slopId, "stripe");
    await record(env.server, id, ok([{ date: today, revenue: { USD: 100 } }]));

    await env.server.mutation(api.integrations.disconnect, { userId: owner, integrationId: id });
    expect(await integrationRows(env)).toEqual([]);
    expect(await metricRows(env)).toEqual([]);
  });

  it("lists the owner's sources without the sealed key", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    await connect(env.server, owner, slopId, "stripe");

    const listed = await env.server.query(api.integrations.listForOwner, { userId: owner, slopId });
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("sealed-key");
    expect(listed[0]).toMatchObject({ provider: "stripe", status: "pending", public: true });
  });
});

describe("claiming sources to sync", () => {
  async function connected() {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    const id = await connect(env.server, owner, slopId, "stripe");
    return { env, slopId, id };
  }

  it("hands over a source that has never synced once, then holds it", async () => {
    const { env, slopId, id } = await connected();

    const first = await env.server.mutation(api.integrations.claim, { productId: slopId });
    expect(first.map((row) => row._id)).toEqual([id]);
    expect(first[0].sealedSecret).toBe("sealed-key");
    expect((await integrationRows(env))[0].syncingAt).not.toBeNull();

    expect(await env.server.mutation(api.integrations.claim, { productId: slopId })).toEqual([]);
    expect(await env.server.mutation(api.integrations.claim, { productId: slopId, force: true })).toEqual([]);
  });

  it("hands it over again once the lock has expired", async () => {
    const { env, slopId, id } = await connected();
    await env.server.mutation(api.integrations.claim, { productId: slopId });

    await patchTimes(env, id, { syncingAt: Date.now() - SYNC_LOCK_MS - 1000 });
    const again = await env.server.mutation(api.integrations.claim, { productId: slopId });
    expect(again.map((row) => row._id)).toEqual([id]);
  });

  it("leaves a recently synced source alone unless forced", async () => {
    const { env, slopId, id } = await connected();
    await record(env.server, id, ok([]));

    expect(await env.server.mutation(api.integrations.claim, { productId: slopId })).toEqual([]);
    const forced = await env.server.mutation(api.integrations.claim, { productId: slopId, force: true });
    expect(forced.map((row) => row._id)).toEqual([id]);
  });

  it("takes a source whose numbers have gone stale", async () => {
    const { env, slopId, id } = await connected();
    await record(env.server, id, ok([]));

    await patchTimes(env, id, { syncedAt: Date.now() - SYNC_EVERY_MS + 5_000 });
    expect(await env.server.mutation(api.integrations.claim, { productId: slopId })).toEqual([]);

    await patchTimes(env, id, { syncedAt: Date.now() - SYNC_EVERY_MS - 1000 });
    const stale = await env.server.mutation(api.integrations.claim, { productId: slopId });
    expect(stale.map((row) => row._id)).toEqual([id]);
  });

  it("frees the lock when a sync reports back", async () => {
    const { env, slopId, id } = await connected();
    await env.server.mutation(api.integrations.claim, { productId: slopId });
    await record(env.server, id, ok([]));
    expect((await integrationRows(env))[0].syncingAt).toBeNull();

    // A forced sync can start again straight away.
    const forced = await env.server.mutation(api.integrations.claim, { productId: slopId, force: true });
    expect(forced).toHaveLength(1);
  });

  it("only claims the product's own sources", async () => {
    const { env, slopId } = await connected();
    const other = await makeUser(env.server, "other");
    const otherSlop = await ship(env.server, other);
    await connect(env.server, other, otherSlop, "stripe");

    const claimed = await env.server.mutation(api.integrations.claim, { productId: slopId });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].productId).toBe(slopId);
  });
});

describe("recording a sync", () => {
  async function connected(provider: Provider = "stripe") {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    const id = await connect(env.server, owner, slopId, provider);
    return { env, slopId, id, owner };
  }

  it("marks the source ok and stores the live count, snapshot and cursor", async () => {
    const { env, id } = await connected("ga4");
    const before = Date.now();
    await record(env.server, id, ok([], { live: 7, snapshot: { people30: 120 }, cursor: '{"a":"b"}' }));

    const [row] = await integrationRows(env);
    expect(row).toMatchObject({
      status: "ok",
      error: null,
      syncingAt: null,
      snapshot: { people30: 120 },
      cursor: '{"a":"b"}',
    });
    expect(row.syncedAt).toBeGreaterThanOrEqual(before);
    expect(row.live?.people).toBe(7);
    expect(row.live?.at).toBe(row.syncedAt);
  });

  it("stores no live count for sources that don't have one", async () => {
    const { env, id } = await connected();
    await record(env.server, id, ok([], { live: null }));
    expect((await integrationRows(env))[0].live).toBeNull();
  });

  it("replaces a day's row when the source recounts whole days", async () => {
    const { env, id } = await connected("ga4");
    await record(env.server, id, ok([{ date: today, people: 5, signups: 2 }]));
    await record(
      env.server,
      id,
      ok([
        { date: today, people: 8 },
        { date: addDays(today, -1), people: 3 },
      ]),
    );

    const metrics = await metricRows(env);
    expect(metrics).toHaveLength(2);
    const day = metrics.find((row) => row.date === today);
    expect(day).toMatchObject({ people: 8 });
    expect(day?.signups).toBeUndefined();
  });

  it("adds to a day's row when the source only reports new payments", async () => {
    const { env, id } = await connected("solana");
    await record(env.server, id, ok([{ date: today, revenue: { USD: 500 } }], { merge: "add" }));
    await record(
      env.server,
      id,
      ok(
        [
          { date: today, revenue: { USD: 300, EUR: 100 } },
          { date: addDays(today, -1), revenue: { USD: 40 } },
        ],
        {
          merge: "add",
        },
      ),
    );

    const metrics = await metricRows(env);
    expect(metrics).toHaveLength(2);
    expect(metrics.find((row) => row.date === today)?.revenue).toEqual({ USD: 800, EUR: 100 });
    expect(metrics.find((row) => row.date === addDays(today, -1))?.revenue).toEqual({ USD: 40 });
  });

  it("adds people and signups when merging by addition", async () => {
    const { env, id } = await connected("ga4");
    await record(env.server, id, ok([{ date: today, people: 3, signups: 1 }], { merge: "add" }));
    await record(env.server, id, ok([{ date: today, people: 2 }], { merge: "add" }));

    const [day] = await metricRows(env);
    expect(day).toMatchObject({ people: 5, signups: 1 });
    expect(day.revenue).toBeUndefined();
  });

  it("keeps what an adding sync has nothing new for", async () => {
    const { env, id } = await connected("solana");
    await record(env.server, id, ok([{ date: today, revenue: { USD: 500 } }], { merge: "add" }));
    await record(env.server, id, ok([{ date: today, people: 1 }], { merge: "add" }));

    const [day] = await metricRows(env);
    expect(day.revenue).toEqual({ USD: 500 });
  });

  it("keeps each source's days apart", async () => {
    const { env, slopId, id, owner } = await connected("ga4");
    const second = await connect(env.server, owner, slopId, "posthog");
    await record(env.server, id, ok([{ date: today, people: 5 }]));
    await record(env.server, second, ok([{ date: today, people: 9 }]));

    const metrics = await metricRows(env);
    expect(metrics).toHaveLength(2);
    expect(metrics.find((row) => row.integrationId === id)?.people).toBe(5);
    expect(metrics.find((row) => row.integrationId === second)?.people).toBe(9);
  });

  it("marks a failed sync as an error but keeps the last numbers and the sync time", async () => {
    const { env, id } = await connected("ga4");
    await record(env.server, id, ok([{ date: today, people: 5 }], { live: 3, snapshot: { people30: 40 } }));
    const [synced] = await integrationRows(env);
    await env.server.mutation(api.integrations.claim, { productId: synced.productId, force: true });

    await record(env.server, id, { ok: false, error: "Add the service account as a Viewer." });

    const [row] = await integrationRows(env);
    expect(row).toMatchObject({ status: "error", error: "Add the service account as a Viewer.", syncingAt: null });
    expect(row.syncedAt).toBe(synced.syncedAt);
    expect(row.snapshot).toEqual({ people30: 40 });
    expect(row.live).toEqual(synced.live);
    expect(await metricRows(env)).toHaveLength(1);
  });

  it("keeps a failed first sync unsynced", async () => {
    const { env, id } = await connected();
    await record(env.server, id, { ok: false, error: "Nope." });
    expect(await integrationRows(env)).toMatchObject([{ status: "error", syncedAt: null }]);
  });

  it("clears the error after the next good sync", async () => {
    const { env, id } = await connected();
    await record(env.server, id, { ok: false, error: "Nope." });
    await record(env.server, id, ok([]));
    expect(await integrationRows(env)).toMatchObject([{ status: "ok", error: null }]);
  });

  it("cuts a long error down to 300 characters", async () => {
    const { env, id } = await connected();
    await record(env.server, id, { ok: false, error: "x".repeat(1000) });
    expect((await integrationRows(env))[0].error).toHaveLength(300);
  });

  it("does nothing for a source that was disconnected mid-sync", async () => {
    const { env, id, owner } = await connected();
    await env.server.mutation(api.integrations.disconnect, { userId: owner, integrationId: id });
    await record(env.server, id, ok([{ date: today, people: 1 }]));
    expect(await metricRows(env)).toEqual([]);
  });
});

describe("traction on a slop's page", () => {
  async function populated() {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const visitor = await makeUser(env.server, "visitor");
    const slopId = await ship(env.server, owner);

    const analytics = await connect(env.server, owner, slopId, "ga4", { settings: { propertyId: "123456789" } });
    const payments = await connect(env.server, owner, slopId, "stripe", {
      settings: { keyEnding: "wxyz" },
      public: false,
    });
    const wallet = await connect(env.server, owner, slopId, "solana", { settings: { wallet: "WalletAddress" } });
    const pending = await connect(env.server, owner, slopId, "posthog", { settings: { projectId: "1" } });

    await record(env.server, analytics, ok([{ date: today, people: 5 }], { live: 2, snapshot: { people30: 40 } }));
    await record(
      env.server,
      payments,
      ok([{ date: today, revenue: { USD: 900 } }], { snapshot: { mrr: { USD: 100 } } }),
    );
    await record(env.server, wallet, ok([{ date: today, revenue: { USD: 250 } }], { merge: "add" }));
    await record(env.server, wallet, { ok: false, error: "The RPC is down." });

    const page = (asUser?: Id<"users">) =>
      env.server.query(api.slops.page, { username: "owner", slug: "tiltmaze", asUser });
    return { env, owner, visitor, slopId, ids: { analytics, payments, wallet, pending }, page };
  }

  it("shows visitors only public sources that have synced", async () => {
    const { visitor, ids, page } = await populated();
    for (const asUser of [visitor, undefined]) {
      const traction = (await page(asUser))?.traction;
      expect(traction?.sources.map((source) => source.id).sort()).toEqual([ids.analytics, ids.wallet].sort());
      expect(traction?.days.map((day) => day.sourceId).sort()).toEqual([ids.analytics, ids.wallet].sort());
    }
  });

  it("shows the owner every source, synced or not", async () => {
    const { owner, ids, page } = await populated();
    const traction = (await page(owner))?.traction;
    expect(traction?.sources.map((source) => source.id).sort()).toEqual(
      [ids.analytics, ids.payments, ids.wallet, ids.pending].sort(),
    );
    expect(traction?.sources.find((source) => source.id === ids.pending)).toMatchObject({
      status: "pending",
      syncedAt: null,
    });
    expect(traction?.days.map((day) => day.sourceId).sort()).toEqual([ids.analytics, ids.payments, ids.wallet].sort());
  });

  it("shows error text to the owner only, while visitors keep the last numbers", async () => {
    const { owner, visitor, ids, page } = await populated();
    const asOwner = (await page(owner))?.traction.sources.find((source) => source.id === ids.wallet);
    const asVisitor = (await page(visitor))?.traction.sources.find((source) => source.id === ids.wallet);

    expect(asOwner).toMatchObject({ status: "error", error: "The RPC is down." });
    expect(asVisitor).toMatchObject({ status: "error", error: null });
    expect((await page(visitor))?.traction.days.find((day) => day.sourceId === ids.wallet)?.revenue).toEqual({
      USD: 250,
    });
  });

  it("describes each source for the board", async () => {
    const { owner, ids, page } = await populated();
    const sources = (await page(owner))?.traction.sources ?? [];
    const analytics = sources.find((source) => source.id === ids.analytics);
    expect(analytics).toMatchObject({
      provider: "ga4",
      kind: "analytics",
      label: null,
      public: true,
      snapshot: { people30: 40 },
    });
    expect(analytics?.live?.people).toBe(2);
    expect(sources.find((source) => source.id === ids.payments)).toMatchObject({
      provider: "stripe",
      kind: "payments",
      public: false,
      snapshot: { mrr: { USD: 100 } },
    });
    // A wallet is public on its chain, so its address is the one setting that is shown.
    expect(sources.find((source) => source.id === ids.wallet)).toMatchObject({
      kind: "payments",
      label: "WalletAddress",
    });
  });

  it("never sends keys or settings", async () => {
    const { owner, visitor, page } = await populated();
    for (const asUser of [owner, visitor, undefined]) {
      const text = JSON.stringify((await page(asUser))?.traction);
      expect(text).not.toContain("sealed-key");
      expect(text).not.toContain("keyEnding");
      expect(text).not.toContain("propertyId");
    }
  });

  it("shows the last 90 days only", async () => {
    const { env, ids, page, owner } = await populated();
    const oldest = addDays(today, -(TRACTION_DAYS - 1));
    await record(
      env.server,
      ids.analytics,
      ok([
        { date: today, people: 5 },
        { date: oldest, people: 1 },
        { date: addDays(oldest, -1), people: 99 },
      ]),
    );
    const dates = (await page(owner))?.traction.days
      .filter((day) => day.sourceId === ids.analytics)
      .map((day) => day.date);
    expect(dates?.sort()).toEqual([oldest, today]);
  });

  it("has nothing to show when no source is public yet", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    const id = await connect(env.server, owner, slopId, "stripe", { public: false });
    await record(env.server, id, ok([{ date: today, revenue: { USD: 1 } }]));

    const page = await env.server.query(api.slops.page, { username: "owner", slug: "tiltmaze" });
    expect(page?.traction).toEqual({ sources: [], days: [] });
  });

  it("shares a product's sources between its launches", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const first = await ship(env.server, owner);
    const relaunch = await ship(env.server, owner, { relaunchOf: first, launchLabel: "iOS beta" });
    const id = await connect(env.server, owner, first, "ga4");
    await record(env.server, id, ok([{ date: today, people: 4 }]));

    const slug = (await env.t.run((ctx) => ctx.db.get(relaunch)))?.slug ?? "";
    const page = await env.server.query(api.slops.page, { username: "owner", slug });
    expect(page?.traction.sources.map((source) => source.id)).toEqual([id]);
  });
});

describe("deleting a launch", () => {
  it("deleting the first launch deletes its integrations and metrics", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const slopId = await ship(env.server, owner);
    const a = await connect(env.server, owner, slopId, "ga4");
    const b = await connect(env.server, owner, slopId, "stripe");
    await record(env.server, a, ok([{ date: today, people: 1 }]));
    await record(
      env.server,
      b,
      ok([
        { date: today, revenue: { USD: 1 } },
        { date: addDays(today, -1), revenue: { USD: 2 } },
      ]),
    );

    await env.server.mutation(api.slops.remove, { slopId, byUserId: owner });

    expect(await integrationRows(env)).toEqual([]);
    expect(await metricRows(env)).toEqual([]);
  });

  it("leaves other products' integrations alone", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const gone = await ship(env.server, owner);
    const kept = await ship(env.server, owner);
    await connect(env.server, owner, gone, "ga4");
    const keptId = await connect(env.server, owner, kept, "ga4");
    await record(env.server, keptId, ok([{ date: today, people: 1 }]));

    await env.server.mutation(api.slops.remove, { slopId: gone, byUserId: owner });

    expect((await integrationRows(env)).map((row) => row._id)).toEqual([keptId]);
    expect(await metricRows(env)).toHaveLength(1);
  });

  it("deleting a later launch keeps the product's integrations", async () => {
    const env = setup();
    const owner = await makeUser(env.server, "owner");
    const first = await ship(env.server, owner);
    const relaunch = await ship(env.server, owner, { relaunchOf: first, launchLabel: "iOS beta" });
    const id = await connect(env.server, owner, first, "ga4");
    await record(env.server, id, ok([{ date: today, people: 1 }]));

    await env.server.mutation(api.slops.remove, { slopId: relaunch, byUserId: owner });

    expect((await integrationRows(env)).map((row) => row._id)).toEqual([id]);
    expect(await metricRows(env)).toHaveLength(1);
  });
});
