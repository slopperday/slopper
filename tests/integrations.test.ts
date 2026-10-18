import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { parseConnect } from "~/.server/integrations";
import { syncGoogleAnalytics } from "~/.server/integrations/google";
import { syncPostHog } from "~/.server/integrations/posthog";
import { SourceError, type SyncInput, type SyncResult } from "~/.server/integrations/source";
import { paidToWallet, STABLECOIN_MINTS, syncSolana } from "~/.server/integrations/solana";
import { monthlyAmount, syncStripe } from "~/.server/integrations/stripe";

interface Call {
  url: URL;
  method: string;
  headers: Headers;
  body: string;
}

function fakeFetch(handler: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const body = init?.body;
    const call: Call = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : "",
    };
    calls.push(call);
    const reply = await handler(call);
    return reply instanceof Response ? reply : new Response(JSON.stringify(reply), { status: 200 });
  };
  return { calls, fetcher };
}

function syncInput(overrides: Partial<SyncInput> & Pick<SyncInput, "fetcher">): SyncInput {
  return { settings: {}, secret: null, cursor: null, since: "2026-10-01", today: "2026-10-03", ...overrides };
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

describe("Stripe monthly amounts", () => {
  function monthly(
    unit: number | null,
    interval: "day" | "week" | "month" | "year" | null,
    count = 1,
    quantity?: number | null,
  ) {
    return monthlyAmount({
      quantity,
      price: { unit_amount: unit, currency: "usd", recurring: interval ? { interval, interval_count: count } : null },
    });
  }

  it("takes monthly prices as they are", () => {
    expect(monthly(1000, "month")).toBe(1000);
  });

  it("divides yearly prices by twelve", () => {
    expect(monthly(12_000, "year")).toBe(1000);
  });

  it("spreads prices over the interval count", () => {
    expect(monthly(3000, "month", 3)).toBe(1000);
    expect(monthly(24_000, "year", 2)).toBe(1000);
  });

  it("multiplies by quantity, treating a missing quantity as one", () => {
    expect(monthly(1000, "month", 1, 3)).toBe(3000);
    expect(monthly(1000, "month", 1, null)).toBe(1000);
    expect(monthly(1000, "month", 1, undefined)).toBe(1000);
  });

  it("converts weekly and daily prices to a month", () => {
    expect(monthly(100, "week")).toBeCloseTo((100 * 52) / 12);
    expect(monthly(10, "day")).toBeCloseTo((10 * 365) / 12);
  });

  it("counts metered, tiered and one-off prices as nothing", () => {
    expect(monthly(null, "month")).toBe(0);
    expect(monthly(1000, null)).toBe(0);
  });
});

describe("syncing Stripe", () => {
  const secret = "rk_live_abcdefghijklmnopqrstuvwx";
  const empty = { data: [], has_more: false };

  function transaction(id: string, iso: string, amount: number, category = "charge", currency = "usd") {
    return { id, amount, currency, reporting_category: category, created: seconds(iso) };
  }

  function stripeFetch(options: {
    transactions?: (url: URL) => unknown;
    subscriptions?: (url: URL) => unknown;
    status?: number;
  }) {
    return fakeFetch(({ url }) => {
      if (options.status) return new Response("{}", { status: options.status });
      if (url.pathname.endsWith("/balance_transactions")) return (options.transactions ?? (() => empty))(url);
      if (url.pathname.endsWith("/subscriptions")) return (options.subscriptions ?? (() => empty))(url);
      throw new Error(`Unexpected request to ${url.href}`);
    });
  }

  it("asks for the key before doing anything", async () => {
    const { fetcher, calls } = stripeFetch({});
    const error = await rejection(syncStripe(syncInput({ fetcher })));
    expect(error).toBeInstanceOf(SourceError);
    expect(calls).toHaveLength(0);
  });

  it("reads with the restricted key, a pinned version and the window start", async () => {
    const { fetcher, calls } = stripeFetch({});
    await syncStripe(syncInput({ fetcher, secret }));

    const balance = calls.find((call) => call.url.pathname === "/v1/balance_transactions");
    const subscriptions = calls.find((call) => call.url.pathname === "/v1/subscriptions");
    expect(balance?.headers.get("authorization")).toBe(`Bearer ${secret}`);
    expect(balance?.headers.get("stripe-version")).toBeTruthy();
    expect(balance?.url.searchParams.get("created[gte]")).toBe(String(seconds("2026-10-01T00:00:00Z")));
    expect(balance?.url.searchParams.get("limit")).toBe("100");
    expect(subscriptions?.url.searchParams.get("status")).toBe("active");
  });

  it("adds revenue by UTC day and upper-case currency, counting refunds against it", async () => {
    const { fetcher } = stripeFetch({
      transactions: () => ({
        has_more: false,
        data: [
          transaction("txn_1", "2026-10-02T23:59:59Z", 1000),
          transaction("txn_2", "2026-10-02T00:00:00Z", 500),
          transaction("txn_3", "2026-10-02T12:00:00Z", -300, "refund"),
          transaction("txn_4", "2026-10-02T12:00:00Z", 700, "charge", "eur"),
          transaction("txn_5", "2026-10-03T00:00:00Z", -200, "dispute"),
          transaction("txn_6", "2026-10-03T01:00:00Z", 200, "dispute_reversal"),
          transaction("txn_7", "2026-10-03T02:00:00Z", 900, "partial_capture_reversal"),
        ],
      }),
    });
    const result = await syncStripe(syncInput({ fetcher, secret }));

    expect(result.merge).toBe("replace");
    expect(result.days).toEqual([
      { date: "2026-10-01", revenue: {} },
      { date: "2026-10-02", revenue: { USD: 1200, EUR: 700 } },
      { date: "2026-10-03", revenue: { USD: 900 } },
    ]);
    expect(result.live).toBeNull();
    expect(result.cursor).toBeNull();
  });

  it("ignores payouts, fees and other balance movements", async () => {
    const { fetcher } = stripeFetch({
      transactions: () => ({
        has_more: false,
        data: [
          transaction("txn_1", "2026-10-02T10:00:00Z", -50_000, "payout"),
          transaction("txn_2", "2026-10-02T10:00:00Z", -320, "fee"),
          transaction("txn_3", "2026-10-02T10:00:00Z", -100, "tax"),
          transaction("txn_4", "2026-10-02T10:00:00Z", 2500),
        ],
      }),
    });
    const result = await syncStripe(syncInput({ fetcher, secret }));
    expect(result.days.find((day) => day.date === "2026-10-02")?.revenue).toEqual({ USD: 2500 });
  });

  it("follows pagination with starting_after until there are no more pages", async () => {
    const { fetcher, calls } = stripeFetch({
      transactions: (url) => {
        const after = url.searchParams.get("starting_after");
        if (after === null) {
          return {
            has_more: true,
            data: [
              transaction("txn_1", "2026-10-02T10:00:00Z", 100),
              transaction("txn_2", "2026-10-02T11:00:00Z", 200),
            ],
          };
        }
        if (after === "txn_2") return { has_more: true, data: [transaction("txn_3", "2026-10-02T12:00:00Z", 400)] };
        if (after === "txn_3") return { has_more: false, data: [transaction("txn_4", "2026-10-03T12:00:00Z", 800)] };
        throw new Error(`Unexpected cursor ${after}`);
      },
    });
    const result = await syncStripe(syncInput({ fetcher, secret }));

    const pages = calls.filter((call) => call.url.pathname === "/v1/balance_transactions");
    expect(pages.map((call) => call.url.searchParams.get("starting_after"))).toEqual([null, "txn_2", "txn_3"]);
    expect(result.days.map((day) => day.revenue)).toEqual([{}, { USD: 700 }, { USD: 800 }]);
  });

  it("counts only the days it fully read when it stops paging early", async () => {
    const pageSize = 20;
    let page = 0;
    const { fetcher, calls } = stripeFetch({
      transactions: () => {
        // Newest first, one payment a day, and always another page.
        const day = 29 - page;
        const id = `txn_${page}`;
        page++;
        return { has_more: true, data: [transaction(id, `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`, 100)] };
      },
    });
    const result = await syncStripe(syncInput({ fetcher, secret, since: "2026-10-01", today: "2026-10-30" }));

    expect(calls.filter((call) => call.url.pathname === "/v1/balance_transactions")).toHaveLength(pageSize);
    // The 20th page reached 10 October, which may be partial: counting starts the day after.
    expect(result.days[0].date).toBe("2026-10-11");
    expect(result.days.at(-1)?.date).toBe("2026-10-30");
  });

  it("normalises recurring revenue per currency and counts subscribers", async () => {
    const price = (unit: number | null, interval: "month" | "year", count = 1, currency = "usd") => ({
      unit_amount: unit,
      currency,
      recurring: { interval, interval_count: count },
    });
    const { fetcher } = stripeFetch({
      subscriptions: () => ({
        has_more: false,
        data: [
          { id: "sub_1", items: { data: [{ quantity: 2, price: price(1000, "month") }] } },
          { id: "sub_2", items: { data: [{ quantity: 1, price: price(12_000, "year") }] } },
          {
            id: "sub_3",
            items: { data: [{ price: price(3000, "month", 3) }, { price: price(null, "month") }] },
          },
          { id: "sub_4", items: { data: [{ price: price(999, "month", 1, "eur") }] } },
        ],
      }),
    });
    const result = await syncStripe(syncInput({ fetcher, secret }));

    expect(result.snapshot).toEqual({ mrr: { USD: 4000, EUR: 999 }, subscribers: 4 });
  });

  it("rounds recurring revenue to whole minor units", async () => {
    const { fetcher } = stripeFetch({
      subscriptions: () => ({
        has_more: false,
        data: [
          {
            id: "sub_1",
            items: {
              data: [
                { price: { unit_amount: 100, currency: "usd", recurring: { interval: "week", interval_count: 1 } } },
              ],
            },
          },
        ],
      }),
    });
    const result = await syncStripe(syncInput({ fetcher, secret }));
    expect(result.snapshot.mrr).toEqual({ USD: 433 });
  });

  it("fills every day from since to today, even with no payments", async () => {
    const { fetcher } = stripeFetch({});
    const result = await syncStripe(syncInput({ fetcher, secret, since: "2026-09-29", today: "2026-10-02" }));
    expect(result.days.map((day) => day.date)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(result.snapshot).toEqual({ mrr: {}, subscribers: 0 });
  });

  it("tells the maker when the key is refused", async () => {
    const { fetcher } = stripeFetch({ status: 401 });
    const error = await rejection(syncStripe(syncInput({ fetcher, secret })));
    expect(error).toBeInstanceOf(SourceError);
    expect((error as Error).message).toContain("didn't accept that key");
  });

  it("tells the maker when the key can't read enough", async () => {
    const { fetcher } = stripeFetch({ status: 403 });
    const error = await rejection(syncStripe(syncInput({ fetcher, secret })));
    expect(error).toBeInstanceOf(SourceError);
    expect((error as Error).message).toContain("Balance and Subscriptions");
  });

  it("lets other failures through as plain errors", async () => {
    const { fetcher } = stripeFetch({ status: 500 });
    const error = await rejection(syncStripe(syncInput({ fetcher, secret })));
    expect(error).not.toBeInstanceOf(SourceError);
    expect((error as Error).message).toContain("api.stripe.com answered 500");
  });
});

describe("Solana payments to a wallet", () => {
  const wallet = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const other = "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj";
  const [usdc = "", usdt = ""] = Object.keys(STABLECOIN_MINTS);

  type Transaction = Parameters<typeof paidToWallet>[0];
  type Balance = { accountIndex: number; mint: string; owner?: string; amount: string };

  function balances(list: Balance[]) {
    return list.map(({ accountIndex, mint, owner, amount }) => ({
      accountIndex,
      mint,
      owner,
      uiTokenAmount: { amount },
    }));
  }

  function transaction(options: {
    pre?: Balance[];
    post?: Balance[];
    signers?: string[];
    err?: unknown;
    blockTime?: number | null;
    noMeta?: boolean;
  }): Transaction {
    return {
      blockTime: options.blockTime === undefined ? seconds("2026-10-02T12:00:00Z") : options.blockTime,
      meta: options.noMeta
        ? null
        : {
            err: options.err ?? null,
            preTokenBalances: balances(options.pre ?? []),
            postTokenBalances: balances(options.post ?? []),
          },
      transaction: {
        message: {
          accountKeys: [
            { pubkey: other, signer: true },
            ...(options.signers ?? []).map((pubkey) => ({ pubkey, signer: true })),
          ],
        },
      },
    };
  }

  describe("paidToWallet", () => {
    it("counts a stablecoin increase to the wallet in cents", () => {
      const paid = transaction({
        pre: [{ accountIndex: 1, mint: usdc, owner: wallet, amount: "1000000" }],
        post: [{ accountIndex: 1, mint: usdc, owner: wallet, amount: "6000000" }],
      });
      expect(paidToWallet(paid, wallet)).toBe(500);
    });

    it("rounds down to whole cents", () => {
      const paid = transaction({ post: [{ accountIndex: 1, mint: usdc, owner: wallet, amount: "1239999" }] });
      expect(paidToWallet(paid, wallet)).toBe(123);
    });

    it("counts the whole balance when the token account is new", () => {
      const paid = transaction({ post: [{ accountIndex: 2, mint: usdt, owner: wallet, amount: "2500000" }] });
      expect(paidToWallet(paid, wallet)).toBe(250);
    });

    it("adds up every stablecoin account the wallet owns", () => {
      const paid = transaction({
        post: [
          { accountIndex: 1, mint: usdc, owner: wallet, amount: "1000000" },
          { accountIndex: 2, mint: usdt, owner: wallet, amount: "2000000" },
        ],
      });
      expect(paidToWallet(paid, wallet)).toBe(300);
    });

    it("ignores payments the wallet signed itself", () => {
      const paid = transaction({
        signers: [wallet],
        post: [{ accountIndex: 1, mint: usdc, owner: wallet, amount: "5000000" }],
      });
      expect(paidToWallet(paid, wallet)).toBe(0);
    });

    it("ignores failed transactions and ones without metadata", () => {
      const post: Balance[] = [{ accountIndex: 1, mint: usdc, owner: wallet, amount: "5000000" }];
      expect(paidToWallet(transaction({ post, err: { InstructionError: [0, "Custom"] } }), wallet)).toBe(0);
      expect(paidToWallet(transaction({ post, noMeta: true }), wallet)).toBe(0);
    });

    it("ignores other tokens, other owners and balances that went down", () => {
      expect(
        paidToWallet(
          transaction({
            post: [
              {
                accountIndex: 1,
                mint: "So11111111111111111111111111111111111111112",
                owner: wallet,
                amount: "9000000",
              },
            ],
          }),
          wallet,
        ),
      ).toBe(0);
      expect(
        paidToWallet(transaction({ post: [{ accountIndex: 1, mint: usdc, owner: other, amount: "9000000" }] }), wallet),
      ).toBe(0);
      expect(
        paidToWallet(
          transaction({
            pre: [{ accountIndex: 1, mint: usdc, owner: wallet, amount: "9000000" }],
            post: [{ accountIndex: 1, mint: usdc, owner: wallet, amount: "4000000" }],
          }),
          wallet,
        ),
      ).toBe(0);
    });
  });

  describe("syncSolana", () => {
    const rpcUrl = "https://rpc.test/";
    const accountUsdc = "UsdcTokenAccount1111111111111111111111111111";
    const accountUsdt = "UsdtTokenAccount1111111111111111111111111111";

    interface Signature {
      signature: string;
      err: unknown;
      blockTime: number | null;
    }

    function signature(name: string, iso: string, err: unknown = null): Signature {
      return { signature: name, err, blockTime: seconds(iso) };
    }

    /** A payment of `dollars` to the wallet's token account, at the signature's time. */
    function payment(item: Signature, dollars: number): Transaction {
      return transaction({
        blockTime: item.blockTime,
        post: [{ accountIndex: 1, mint: usdc, owner: wallet, amount: String(dollars * 1_000_000) }],
      });
    }

    interface Chain {
      /** Token accounts by mint. */
      accounts?: Record<string, string[]>;
      /** Newest first, as the RPC returns them. */
      signatures?: Record<string, Signature[]>;
      transactions?: Record<string, Transaction | null>;
    }

    function rpcFetch(chain: Chain) {
      const methods: { method: string; params: unknown[] }[] = [];
      const bodies: unknown[] = [];
      const { fetcher, calls } = fakeFetch(({ body }) => {
        const parsed: unknown = JSON.parse(body);
        bodies.push(parsed);
        if (!Array.isArray(parsed)) throw new Error("The RPC must be called in batches.");
        const replies = (parsed as { id: number; method: string; params: unknown[] }[]).map(
          ({ id, method, params }) => {
            methods.push({ method, params });
            if (method === "getTokenAccountsByOwner") {
              const mint = (params[1] as { mint: string }).mint;
              return {
                jsonrpc: "2.0",
                id,
                result: { value: (chain.accounts?.[mint] ?? []).map((pubkey) => ({ pubkey })) },
              };
            }
            if (method === "getSignaturesForAddress") {
              const [account, options] = params as [string, { until?: string; before?: string; limit?: number }];
              const all = chain.signatures?.[account] ?? [];
              const stop = options.until ? all.findIndex((item) => item.signature === options.until) : -1;
              const newer = stop === -1 ? all : all.slice(0, stop);
              const start = options.before ? newer.findIndex((item) => item.signature === options.before) + 1 : 0;
              // Like the real node: newest first, older than `before`, newer than `until`, no more than `limit`.
              const page = newer.slice(start);
              return { jsonrpc: "2.0", id, result: page.slice(0, options.limit ?? page.length) };
            }
            if (method === "getTransaction") {
              const name = params[0] as string;
              return { jsonrpc: "2.0", id, result: chain.transactions?.[name] ?? null };
            }
            return { jsonrpc: "2.0", id, error: { code: -32601, message: `no ${method}` } };
          },
        );
        // Batched replies may come back in any order.
        return replies.reverse();
      });
      return { fetcher, calls, methods, bodies };
    }

    const sync = (chain: Chain, overrides: Partial<SyncInput> = {}) => {
      const rpc = rpcFetch(chain);
      const result = syncSolana(syncInput({ settings: { wallet }, fetcher: rpc.fetcher, ...overrides }), rpcUrl);
      return { rpc, result };
    };

    it("rejects an address that isn't a wallet", async () => {
      const { result } = sync({}, { settings: { wallet: "not a wallet" } });
      await expect(result).rejects.toBeInstanceOf(SourceError);
    });

    it("finds no days when the wallet has no stablecoin token accounts", async () => {
      const { rpc, result } = sync({});
      await expect(result).resolves.toEqual({ merge: "add", days: [], live: null, snapshot: {}, cursor: null });
      expect(rpc.methods.map((call) => call.method)).toEqual(["getTokenAccountsByOwner", "getTokenAccountsByOwner"]);
      expect(rpc.methods.map((call) => (call.params[1] as { mint: string }).mint)).toEqual([usdc, usdt]);
    });

    it("keeps the cursor it was given when there is nothing to read", async () => {
      const { result } = sync({}, { cursor: '{"a":"b"}' });
      expect((await result).cursor).toBe('{"a":"b"}');
    });

    it("adds up payments by UTC day in cents, and remembers the newest signature", async () => {
      const s1 = signature("s1", "2026-10-02T10:00:00Z");
      const s2 = signature("s2", "2026-10-02T23:00:00Z");
      const s3 = signature("s3", "2026-10-03T01:00:00Z");
      const { rpc, result } = sync({
        accounts: { [usdc]: [accountUsdc] },
        signatures: { [accountUsdc]: [s3, s2, s1] },
        transactions: { s1: payment(s1, 5), s2: payment(s2, 3), s3: payment(s3, 10) },
      });
      const synced = await result;

      expect(synced.merge).toBe("add");
      expect(synced.days).toEqual([
        { date: "2026-10-02", revenue: { USD: 800 } },
        { date: "2026-10-03", revenue: { USD: 1000 } },
      ]);
      expect(JSON.parse(synced.cursor ?? "")).toEqual({ [accountUsdc]: "s3" });
      // Transactions are fetched in one batch, not one request each.
      const transactionBatches = rpc.bodies.filter(
        (body) => Array.isArray(body) && (body as { method: string }[])[0].method === "getTransaction",
      );
      expect(transactionBatches).toHaveLength(1);
    });

    it("asks for signatures only after each token account's cursor", async () => {
      const a1 = signature("a1", "2026-10-02T10:00:00Z");
      const a2 = signature("a2", "2026-10-02T11:00:00Z");
      const a3 = signature("a3", "2026-10-03T01:00:00Z");
      const b1 = signature("b1", "2026-10-02T12:00:00Z");
      const { rpc, result } = sync(
        {
          accounts: { [usdc]: [accountUsdc], [usdt]: [accountUsdt] },
          signatures: { [accountUsdc]: [a3, a2, a1], [accountUsdt]: [b1] },
          transactions: { a2: payment(a2, 2), a3: payment(a3, 3), b1: payment(b1, 4) },
        },
        { cursor: JSON.stringify({ [accountUsdc]: "a1" }) },
      );
      const synced = await result;

      const requested = rpc.methods.filter((call) => call.method === "getSignaturesForAddress");
      expect(requested.map((call) => call.params[0])).toEqual([accountUsdc, accountUsdt]);
      expect((requested[0].params[1] as { until?: string }).until).toBe("a1");
      expect((requested[1].params[1] as { until?: string }).until).toBeUndefined();
      expect(rpc.methods.filter((call) => call.method === "getTransaction").map((call) => call.params[0])).toEqual([
        "a2",
        "b1",
        "a3",
      ]);
      expect(JSON.parse(synced.cursor ?? "")).toEqual({ [accountUsdc]: "a3", [accountUsdt]: "b1" });
      expect(synced.days).toEqual([
        { date: "2026-10-02", revenue: { USD: 600 } },
        { date: "2026-10-03", revenue: { USD: 300 } },
      ]);
    });

    it("keeps counting payments older than since once it has a cursor", async () => {
      const old = signature("old", "2026-09-01T10:00:00Z");
      const { result } = sync(
        {
          accounts: { [usdc]: [accountUsdc] },
          signatures: { [accountUsdc]: [old, signature("seen", "2026-08-01T00:00:00Z")] },
          transactions: { old: payment(old, 1) },
        },
        { cursor: JSON.stringify({ [accountUsdc]: "seen" }) },
      );
      expect((await result).days).toEqual([{ date: "2026-09-01", revenue: { USD: 100 } }]);
    });

    it("ignores signatures from before since on the first sync", async () => {
      const before = signature("before", "2026-09-30T23:59:59Z");
      const inside = signature("inside", "2026-10-01T00:00:00Z");
      const { rpc, result } = sync({
        accounts: { [usdc]: [accountUsdc] },
        signatures: { [accountUsdc]: [inside, before] },
        transactions: { before: payment(before, 100), inside: payment(inside, 1) },
      });
      const synced = await result;

      expect(rpc.methods.filter((call) => call.method === "getTransaction").map((call) => call.params[0])).toEqual([
        "inside",
      ]);
      expect(synced.days).toEqual([{ date: "2026-10-01", revenue: { USD: 100 } }]);
    });

    it("starts from the newest signature next time when nothing is in range", async () => {
      const { rpc, result } = sync({
        accounts: { [usdc]: [accountUsdc] },
        signatures: {
          [accountUsdc]: [signature("recentish", "2026-09-20T00:00:00Z"), signature("older", "2026-09-10T00:00:00Z")],
        },
      });
      const synced = await result;
      expect(synced.days).toEqual([]);
      expect(JSON.parse(synced.cursor ?? "")).toEqual({ [accountUsdc]: "recentish" });
      expect(rpc.methods.some((call) => call.method === "getTransaction")).toBe(false);
    });

    it("stops at a transaction the node can't serve yet and reads it next time", async () => {
      const s1 = signature("s1", "2026-10-02T10:00:00Z");
      const s2 = signature("s2", "2026-10-02T11:00:00Z");
      const s3 = signature("s3", "2026-10-02T12:00:00Z");
      const { result } = sync({
        accounts: { [usdc]: [accountUsdc] },
        signatures: { [accountUsdc]: [s3, s2, s1] },
        transactions: { s1: payment(s1, 1), s2: null, s3: payment(s3, 9) },
      });
      const synced = await result;

      expect(synced.days).toEqual([{ date: "2026-10-02", revenue: { USD: 100 } }]);
      expect(JSON.parse(synced.cursor ?? "")).toEqual({ [accountUsdc]: "s1" });
    });

    it("skips failed transactions without fetching them, and moves past them", async () => {
      const ok = signature("ok", "2026-10-02T10:00:00Z");
      const failed = signature("failed", "2026-10-02T11:00:00Z", { InstructionError: [0, "Custom"] });
      const { rpc, result } = sync({
        accounts: { [usdc]: [accountUsdc] },
        signatures: { [accountUsdc]: [failed, ok] },
        transactions: { ok: payment(ok, 2) },
      });
      const synced = await result;

      expect(rpc.methods.filter((call) => call.method === "getTransaction").map((call) => call.params[0])).toEqual([
        "ok",
      ]);
      expect(synced.days).toEqual([{ date: "2026-10-02", revenue: { USD: 200 } }]);
      expect(JSON.parse(synced.cursor ?? "")).toEqual({ [accountUsdc]: "failed" });
    });

    it("reads a bounded number of transactions per sync, oldest first", async () => {
      const signatures = Array.from({ length: 45 }, (_, index) =>
        signature(`s${index}`, new Date(seconds("2026-10-02T00:00:00Z") * 1000 + index * 60_000).toISOString()),
      );
      const transactions = Object.fromEntries(signatures.map((item) => [item.signature, payment(item, 1)]));
      const { rpc, result } = sync({
        accounts: { [usdc]: [accountUsdc] },
        signatures: { [accountUsdc]: [...signatures].reverse() },
        transactions,
      });
      const synced = await result;

      expect(rpc.methods.filter((call) => call.method === "getTransaction")).toHaveLength(40);
      expect(synced.days).toEqual([{ date: "2026-10-02", revenue: { USD: 4000 } }]);
      expect(JSON.parse(synced.cursor ?? "")).toEqual({ [accountUsdc]: "s39" });
    });

    // The node pages 1,000 signatures at a time, newest first: the oldest must still be read before the cursor moves.
    it("reads every payment even when more than a page arrived since the last sync", async () => {
      const start = seconds("2026-10-02T00:00:00Z");
      const seed = signature("seed", "2026-10-01T12:00:00Z");
      const fresh = Array.from({ length: 1005 }, (_, index) =>
        signature(`n${index}`, new Date((start + index * 60) * 1000).toISOString()),
      );
      const chain: Chain = {
        accounts: { [usdc]: [accountUsdc] },
        signatures: { [accountUsdc]: [...fresh].reverse().concat(seed) },
        transactions: Object.fromEntries(fresh.map((item) => [item.signature, payment(item, 1)])),
      };

      let cursor: string | null = JSON.stringify({ [accountUsdc]: "seed" });
      let cents = 0;
      for (let round = 0; round < 30; round++) {
        const synced: SyncResult = await sync(chain, { cursor }).result;
        cents += synced.days.reduce((sum, day) => sum + (day.revenue?.USD ?? 0), 0);
        cursor = synced.cursor;
      }
      expect(cents).toBe(1005 * 100);
    });

    it("surfaces an RPC error as a plain error", async () => {
      const { fetcher } = fakeFetch(({ body }) =>
        (JSON.parse(body) as { id: number }[]).map(({ id }) => ({
          jsonrpc: "2.0",
          id,
          error: { code: -32005, message: "Node is behind" },
        })),
      );
      const error = await rejection(syncSolana(syncInput({ settings: { wallet }, fetcher }), rpcUrl));
      expect(error).not.toBeInstanceOf(SourceError);
      expect((error as Error).message).toBe("Solana RPC: Node is behind");
    });
  });
});

describe("syncing Google Analytics", () => {
  let privateKey = "";
  let publicKey: CryptoKey;
  let accounts = 0;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = await exportPKCS8(pair.privateKey);
    publicKey = pair.publicKey;
  });

  /** A new email each time, so the module's token cache never carries over. */
  function newAccount() {
    accounts++;
    return { clientEmail: `reader-${accounts}@slopper.iam.gserviceaccount.com`, privateKey };
  }

  const settings = { propertyId: "123456789" };
  const row = (date: string, value: number) => ({
    dimensionValues: [{ value: date }],
    metricValues: [{ value: String(value) }],
  });
  const single = (value: number) => ({ rows: [{ dimensionValues: [], metricValues: [{ value: String(value) }] }] });

  function googleFetch(options: {
    reports?: unknown[];
    realtime?: unknown;
    failure?: { status: number; body: string };
  }) {
    return fakeFetch(({ url }) => {
      if (url.href === "https://oauth2.googleapis.com/token") return { access_token: "token-1", expires_in: 3600 };
      if (options.failure) return new Response(options.failure.body, { status: options.failure.status });
      if (url.pathname.endsWith(":batchRunReports")) return { reports: options.reports ?? [{}, {}, {}] };
      if (url.pathname.endsWith(":runRealtimeReport")) return options.realtime ?? {};
      throw new Error(`Unexpected request to ${url.href}`);
    });
  }

  it("trades a signed service account assertion for a token", async () => {
    const account = newAccount();
    const { fetcher, calls } = googleFetch({});
    await syncGoogleAnalytics(syncInput({ fetcher, settings }), account);

    const exchange = calls[0];
    expect(exchange.method).toBe("POST");
    expect(exchange.url.href).toBe("https://oauth2.googleapis.com/token");
    expect(exchange.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(exchange.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const { payload, protectedHeader } = await jwtVerify(form.get("assertion") ?? "", publicKey, {
      issuer: account.clientEmail,
      audience: "https://oauth2.googleapis.com/token",
    });
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.scope).toBe("https://www.googleapis.com/auth/analytics.readonly");
  });

  it("reuses a token that hasn't expired", async () => {
    const account = newAccount();
    const { fetcher, calls } = googleFetch({});
    await syncGoogleAnalytics(syncInput({ fetcher, settings }), account);
    await syncGoogleAnalytics(syncInput({ fetcher, settings }), account);
    expect(calls.filter((call) => call.url.href === "https://oauth2.googleapis.com/token")).toHaveLength(1);
  });

  it("asks for people, signups and 30-day people with the token", async () => {
    const { fetcher, calls } = googleFetch({});
    await syncGoogleAnalytics(syncInput({ fetcher, settings }), newAccount());

    const batch = calls.find((call) => call.url.pathname === "/v1beta/properties/123456789:batchRunReports");
    expect(batch?.headers.get("authorization")).toBe("Bearer token-1");
    const body = JSON.parse(batch?.body ?? "") as {
      requests: {
        dateRanges: { startDate: string; endDate: string }[];
        metrics: { name: string }[];
        dimensionFilter?: { filter: { stringFilter: { value: string } } };
      }[];
    };
    expect(body.requests).toHaveLength(3);
    expect(body.requests[0].dateRanges).toEqual([{ startDate: "2026-10-01", endDate: "today" }]);
    expect(body.requests[0].metrics).toEqual([{ name: "activeUsers" }]);
    expect(body.requests[1].metrics).toEqual([{ name: "eventCount" }]);
    expect(body.requests[1].dimensionFilter?.filter.stringFilter.value).toBe("sign_up");
    expect(body.requests[2].dateRanges).toEqual([{ startDate: "29daysAgo", endDate: "today" }]);
    expect(calls.some((call) => call.url.pathname.endsWith(":runRealtimeReport"))).toBe(true);
  });

  it("counts the event the maker named", async () => {
    const { fetcher, calls } = googleFetch({});
    await syncGoogleAnalytics(syncInput({ fetcher, settings: { ...settings, signupEvent: "joined" } }), newAccount());
    const batch = calls.find((call) => call.url.pathname.endsWith(":batchRunReports"));
    expect(batch?.body).toContain('"value":"joined"');
  });

  it("reads each report into ISO dates and fills the days it has no rows for", async () => {
    const { fetcher } = googleFetch({
      reports: [{ rows: [row("20261001", 4), row("20261003", 9)] }, { rows: [row("20261003", 2)] }, single(31)],
      realtime: single(5),
    });
    const result = await syncGoogleAnalytics(syncInput({ fetcher, settings }), newAccount());

    expect(result.merge).toBe("replace");
    expect(result.days).toEqual([
      { date: "2026-10-01", people: 4, signups: 0 },
      { date: "2026-10-02", people: 0, signups: 0 },
      { date: "2026-10-03", people: 9, signups: 2 },
    ]);
    expect(result.live).toBe(5);
    expect(result.snapshot).toEqual({ people30: 31 });
    expect(result.cursor).toBeNull();
  });

  it("reports nobody on it and nothing in 30 days when the rows are missing", async () => {
    const { fetcher } = googleFetch({ reports: [{}, {}, {}], realtime: {} });
    const result = await syncGoogleAnalytics(syncInput({ fetcher, settings }), newAccount());
    expect(result.live).toBe(0);
    expect(result.snapshot).toEqual({ people30: 0 });
    expect(result.days).toHaveLength(3);
  });

  it("includes a day the property is ahead of UTC", async () => {
    const { fetcher } = googleFetch({ reports: [{ rows: [row("20261004", 3)] }, {}, {}] });
    const result = await syncGoogleAnalytics(syncInput({ fetcher, settings }), newAccount());
    expect(result.days.at(-1)).toEqual({ date: "2026-10-04", people: 3, signups: 0 });
  });

  it("names the service account when it hasn't been given access", async () => {
    const account = newAccount();
    const { fetcher } = googleFetch({
      failure: { status: 403, body: '{"error":{"status":"PERMISSION_DENIED"}}' },
    });
    const error = await rejection(syncGoogleAnalytics(syncInput({ fetcher, settings }), account));
    expect(error).toBeInstanceOf(SourceError);
    expect((error as Error).message).toContain(account.clientEmail);
    expect((error as Error).message).toContain("123456789");
  });

  it("says when the property doesn't exist", async () => {
    const missing = googleFetch({ failure: { status: 404, body: "{}" } });
    const error = await rejection(syncGoogleAnalytics(syncInput({ fetcher: missing.fetcher, settings }), newAccount()));
    expect(error).toBeInstanceOf(SourceError);
    expect((error as Error).message).toContain("no property 123456789");

    const bad = googleFetch({ failure: { status: 400, body: '{"error":"Invalid property"}' } });
    const badError = await rejection(syncGoogleAnalytics(syncInput({ fetcher: bad.fetcher, settings }), newAccount()));
    expect(badError).toBeInstanceOf(SourceError);
  });

  it("lets other failures through as plain errors", async () => {
    const { fetcher } = googleFetch({ failure: { status: 500, body: "boom" } });
    const error = await rejection(syncGoogleAnalytics(syncInput({ fetcher, settings }), newAccount()));
    expect(error).not.toBeInstanceOf(SourceError);
  });

  it("rejects a property id that isn't a number", async () => {
    const { fetcher, calls } = googleFetch({});
    const error = await rejection(
      syncGoogleAnalytics(syncInput({ fetcher, settings: { propertyId: "G-ABC123" } }), newAccount()),
    );
    expect(error).toBeInstanceOf(SourceError);
    expect(calls).toHaveLength(0);
  });
});

describe("syncing PostHog", () => {
  const secret = "phx_abcdefghijklmnopqrstuvwxyz";
  const settings = { host: "https://eu.posthog.com", projectId: "4242" };

  function postHogFetch(options: { daily?: unknown[][]; live?: unknown[][]; status?: number } = {}) {
    return fakeFetch(({ body }) => {
      if (options.status) return new Response("{}", { status: options.status });
      const sql = (JSON.parse(body) as { query: { query: string } }).query.query;
      return { results: sql.includes("INTERVAL 30 MINUTE") ? (options.live ?? []) : (options.daily ?? []) };
    });
  }

  it("queries the project on its host with the bearer key", async () => {
    const { fetcher, calls } = postHogFetch();
    await syncPostHog(syncInput({ fetcher, secret, settings }));

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.method).toBe("POST");
      expect(call.url.href).toBe("https://eu.posthog.com/api/projects/4242/query/");
      expect(call.headers.get("authorization")).toBe(`Bearer ${secret}`);
      expect(JSON.parse(call.body)).toMatchObject({ query: { kind: "HogQLQuery" } });
    }
  });

  it("uses a self-hosted address as given", async () => {
    const { fetcher, calls } = postHogFetch();
    const lookedUp: string[] = [];
    await syncPostHog(
      syncInput({ fetcher, secret, settings: { ...settings, host: "https://ph.example.com" } }),
      (host) => {
        lookedUp.push(host);
        return Promise.resolve(true);
      },
    );
    expect(lookedUp).toEqual(["ph.example.com"]);
    expect(calls[0].url.href).toBe("https://ph.example.com/api/projects/4242/query/");
  });

  it("never sends the key to a self-hosted address that resolves privately or not at all", async () => {
    for (const isPublicHost of [() => Promise.resolve(false), () => Promise.reject(new Error("ENOTFOUND"))]) {
      const { fetcher, calls } = postHogFetch();
      const error = await rejection(
        syncPostHog(
          syncInput({ fetcher, secret, settings: { ...settings, host: "https://ph.example.com" } }),
          isPublicHost,
        ),
      );
      expect(error).toBeInstanceOf(SourceError);
      expect(calls).toHaveLength(0);
    }
  });

  it("counts the signup event in the query, the default or the maker's own", async () => {
    const standard = postHogFetch();
    await syncPostHog(syncInput({ fetcher: standard.fetcher, secret, settings }));
    expect(standard.calls[0].body).toContain("event = 'sign_up'");
    expect(standard.calls[0].body).toContain("2026-10-01 00:00:00");

    const custom = postHogFetch();
    await syncPostHog(
      syncInput({ fetcher: custom.fetcher, secret, settings: { ...settings, signupEvent: "signed up" } }),
    );
    expect(custom.calls[0].body).toContain("event = 'signed up'");
  });

  it("reads days, people on it now and people in 30 days, filling empty days", async () => {
    const { fetcher } = postHogFetch({
      daily: [
        ["2026-10-01", 12, 3],
        ["2026-10-03", "7", "1"],
      ],
      live: [[4, 88]],
    });
    const result = await syncPostHog(syncInput({ fetcher, secret, settings }));

    expect(result.merge).toBe("replace");
    expect(result.days).toEqual([
      { date: "2026-10-01", people: 12, signups: 3 },
      { date: "2026-10-02", people: 0, signups: 0 },
      { date: "2026-10-03", people: 7, signups: 1 },
    ]);
    expect(result.live).toBe(4);
    expect(result.snapshot).toEqual({ people30: 88 });
    expect(result.cursor).toBeNull();
  });

  it("reports zero when the project has no events", async () => {
    const { fetcher } = postHogFetch();
    const result = await syncPostHog(syncInput({ fetcher, secret, settings }));
    expect(result.live).toBe(0);
    expect(result.snapshot).toEqual({ people30: 0 });
    expect(result.days).toHaveLength(3);
  });

  it("includes days past UTC today that the project already has", async () => {
    const { fetcher } = postHogFetch({ daily: [["2026-10-04", 2, 0]] });
    const result = await syncPostHog(syncInput({ fetcher, secret, settings }));
    expect(result.days.at(-1)).toEqual({ date: "2026-10-04", people: 2, signups: 0 });
  });

  it("explains a refused key, a missing scope and an unknown project", async () => {
    const messages: Record<number, string> = {};
    for (const status of [401, 403, 404]) {
      const { fetcher } = postHogFetch({ status });
      const error = await rejection(syncPostHog(syncInput({ fetcher, secret, settings })));
      expect(error).toBeInstanceOf(SourceError);
      messages[status] = (error as Error).message;
    }
    expect(messages[401]).toContain("didn't accept that key");
    expect(messages[403]).toContain("Query Read");
    expect(messages[404]).toContain("no project 4242");
    expect(messages[404]).toContain("eu.posthog.com");
  });

  it("lets other failures through as plain errors", async () => {
    const { fetcher } = postHogFetch({ status: 500 });
    const error = await rejection(syncPostHog(syncInput({ fetcher, secret, settings })));
    expect(error).not.toBeInstanceOf(SourceError);
  });

  it("rejects bad event names before anything is sent", async () => {
    for (const signupEvent of ["it's", "back\\slash", "x".repeat(65), "semi;colon", 'quote"']) {
      const { fetcher, calls } = postHogFetch();
      const error = await rejection(
        syncPostHog(syncInput({ fetcher, secret, settings: { ...settings, signupEvent } })),
      );
      expect(error, signupEvent).toBeInstanceOf(SourceError);
      expect(calls).toHaveLength(0);
    }
  });

  it("asks for the key and a numeric project id", async () => {
    const { fetcher, calls } = postHogFetch();
    expect(await rejection(syncPostHog(syncInput({ fetcher, settings })))).toBeInstanceOf(SourceError);
    expect(
      await rejection(syncPostHog(syncInput({ fetcher, secret, settings: { ...settings, projectId: "abc" } }))),
    ).toBeInstanceOf(SourceError);
    expect(calls).toHaveLength(0);
  });
});

describe("reading connect forms", () => {
  function form(entries: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(entries)) data.append(name, value);
    return data;
  }

  function failure(result: ReturnType<typeof parseConnect>): string {
    if (result.ok) throw new Error("Expected the form to be rejected.");
    return result.error;
  }

  describe("Stripe", () => {
    const restricted = "rk_live_abcdefghijklmnopqrstuvwx";

    it("accepts a restricted key and remembers only its last four characters", () => {
      const result = parseConnect("stripe", form({ key: `  ${restricted}  ` }));
      expect(result).toEqual({ ok: true, value: { settings: { keyEnding: "uvwx" }, secret: restricted } });
      expect(parseConnect("stripe", form({ key: "rk_test_abcdefghijklmnopqrstuvwx" })).ok).toBe(true);
    });

    it("rejects a full secret key with a specific message", () => {
      expect(failure(parseConnect("stripe", form({ key: "sk_live_abcdefghijklmnopqrstuvwx" })))).toBe(
        "That's a secret key. Make a restricted key instead.",
      );
      expect(failure(parseConnect("stripe", form({ key: "sk_test_abcdefghijklmnopqrstuvwx" })))).toContain(
        "secret key",
      );
    });

    it("rejects anything else that isn't a restricted key", () => {
      for (const key of ["", "pk_live_abcdefghijklmnopqrstuvwx", "rk_live_short", "rk_dev_abcdefghijklmnopqrstuvwx"]) {
        expect(failure(parseConnect("stripe", form({ key }))), key).toContain("restricted key");
      }
    });
  });

  describe("Solana", () => {
    it("accepts a wallet address and needs no secret", () => {
      const wallet = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
      expect(parseConnect("solana", form({ wallet: ` ${wallet} ` }))).toEqual({
        ok: true,
        value: { settings: { wallet }, secret: null },
      });
    });

    it("rejects addresses that aren't wallets", () => {
      for (const wallet of [
        "",
        "short",
        "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl",
        "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin9xQe",
      ]) {
        expect(failure(parseConnect("solana", form({ wallet }))), wallet).toBe("That isn't a Solana wallet address.");
      }
    });
  });

  describe("Google Analytics", () => {
    it("accepts a numeric property id with the default signup event", () => {
      expect(parseConnect("ga4", form({ propertyId: "123456789" }))).toEqual({
        ok: true,
        value: { settings: { propertyId: "123456789", signupEvent: "sign_up" }, secret: null },
      });
    });

    it("keeps the maker's signup event", () => {
      const result = parseConnect("ga4", form({ propertyId: "123456789", signupEvent: "joined" }));
      expect(result.ok && result.value.settings.signupEvent).toBe("joined");
    });

    it("rejects measurement ids and other non-numeric property ids", () => {
      for (const propertyId of ["", "G-ABC123XYZ", "1234", "12 345 678", "1".repeat(15)]) {
        expect(failure(parseConnect("ga4", form({ propertyId }))), propertyId).toContain("property id");
      }
    });

    it("rejects a signup event that isn't an event name", () => {
      expect(failure(parseConnect("ga4", form({ propertyId: "123456789", signupEvent: "it's" })))).toBe(
        "That doesn't look like an event name.",
      );
    });
  });

  describe("PostHog", () => {
    const key = "phx_abcdefghijklmnopqrstuvwxyz";
    const valid = { key, projectId: "4242", region: "us" };

    it("uses the Cloud address for the US and EU regions", () => {
      expect(parseConnect("posthog", form(valid))).toEqual({
        ok: true,
        value: {
          settings: { host: "https://us.posthog.com", projectId: "4242", signupEvent: "sign_up" },
          secret: key,
        },
      });
      const eu = parseConnect("posthog", form({ ...valid, region: "eu" }));
      expect(eu.ok && eu.value.settings.host).toBe("https://eu.posthog.com");
    });

    it("ignores a typed host for the Cloud regions", () => {
      const result = parseConnect("posthog", form({ ...valid, host: "https://evil.example" }));
      expect(result.ok && result.value.settings.host).toBe("https://us.posthog.com");
    });

    it("accepts a self-hosted https address and keeps only its origin", () => {
      const result = parseConnect(
        "posthog",
        form({ ...valid, region: "self", host: "https://ph.example.com/some/path?x=1" }),
      );
      expect(result.ok && result.value.settings.host).toBe("https://ph.example.com");
    });

    it("rejects self-hosted addresses that aren't https", () => {
      for (const host of [
        "",
        "http://ph.example.com",
        "ph.example.com",
        "ftp://ph.example.com",
        "javascript:alert(1)",
      ]) {
        expect(failure(parseConnect("posthog", form({ ...valid, region: "self", host }))), host).toBe(
          "Self-hosted PostHog needs its https address.",
        );
      }
      expect(failure(parseConnect("posthog", form({ key, projectId: "4242" })))).toContain("https address");
    });

    // The key is sent to this address, so it must never be the server's own network.
    it("rejects self-hosted addresses on private networks", () => {
      for (const host of ["https://127.0.0.1", "https://localhost", "https://169.254.169.254", "https://10.0.0.5"]) {
        expect(parseConnect("posthog", form({ ...valid, region: "self", host })).ok, host).toBe(false);
      }
    });

    it("rejects a key that isn't a personal API key", () => {
      expect(failure(parseConnect("posthog", form({ ...valid, key: "phc_projectkeyprojectkeyproject" })))).toContain(
        "phx_",
      );
      expect(failure(parseConnect("posthog", form({ ...valid, key: "" })))).toContain("phx_");
    });

    it("rejects a project id that isn't a number", () => {
      expect(failure(parseConnect("posthog", form({ ...valid, projectId: "abc" })))).toBe(
        "The project id is a number.",
      );
    });

    it("rejects a signup event that isn't an event name", () => {
      expect(failure(parseConnect("posthog", form({ ...valid, signupEvent: "a'b" })))).toBe(
        "That doesn't look like an event name.",
      );
    });
  });
});
