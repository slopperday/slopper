import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FlagDefinition } from "@slopperday/analytics/shared/flags";
import { flagFormValues, flagSummary, parseFlagForm } from "~/lib/flagForm";

/**
 * Flags on the app server: definitions read from Convex and kept in memory,
 * what flags can target, the admin form, and the id a visitor's first page
 * gives them to be bucketed by.
 */

const query = vi.fn<() => Promise<FlagDefinition[]>>();

vi.mock("~/.server/convex", () => ({ convex: { query } }));
vi.mock(import("~/.server/config"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    config: { ...actual.config, analyticsEndpoint: "https://x.convex.site/a", appUrl: new URL("https://slopper.day") },
  };
});

const { flagDefinitions, flagProperties, flagsFor, forgetFlagDefinitions } = await import("~/.server/flags");
const { analyticsIdContext, analyticsIdentity, analyticsMiddleware } = await import("~/.server/analytics");

const NOW = 1_800_000_000_000;

function definition(key: string): FlagDefinition {
  return {
    key,
    active: true,
    variants: null,
    conditions: [{ filters: [], rollout: 100, variant: null }],
    payloads: {},
  };
}

/** Lets settled reads update the cache. */
async function settle() {
  for (let round = 0; round < 3; round += 1) await Promise.resolve();
}

beforeEach(() => {
  forgetFlagDefinitions();
  query.mockReset();
});

describe("flag definitions", () => {
  it("reads Convex once, then uses what it read for half a minute", async () => {
    query.mockResolvedValue([definition("a")]);
    expect(await flagDefinitions(NOW)).toEqual([definition("a")]);
    expect(await flagDefinitions(NOW + 29_000)).toEqual([definition("a")]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("answers from memory while it reads again, for up to five minutes", async () => {
    query.mockResolvedValueOnce([definition("a")]);
    await flagDefinitions(NOW);
    let finish: (flags: FlagDefinition[]) => void = () => {};
    query.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    // Stale: the page gets the old flags at once, and one read starts.
    expect(await flagDefinitions(NOW + 60_000)).toEqual([definition("a")]);
    expect(await flagDefinitions(NOW + 61_000)).toEqual([definition("a")]);
    expect(query).toHaveBeenCalledTimes(2);
    finish([definition("b")]);
    await settle();
    expect(await flagDefinitions(NOW + 62_000)).toEqual([definition("b")]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("waits for a fresh read once what it has is over five minutes old", async () => {
    query.mockResolvedValueOnce([definition("a")]).mockResolvedValueOnce([definition("b")]);
    await flagDefinitions(NOW);
    expect(await flagDefinitions(NOW + 301_000)).toEqual([definition("b")]);
  });

  it("doesn't keep a failed read", async () => {
    query.mockRejectedValueOnce(new Error("Convex is down")).mockResolvedValueOnce([definition("a")]);
    await expect(flagDefinitions(NOW)).rejects.toThrow("Convex is down");
    await settle();
    expect(await flagDefinitions(NOW + 1_000)).toEqual([definition("a")]);
  });

  it("forgets, for an admin's change, even a read that was under way", async () => {
    query.mockResolvedValueOnce([definition("a")]);
    await flagDefinitions(NOW);
    let finish: (flags: FlagDefinition[]) => void = () => {};
    query.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await flagDefinitions(NOW + 60_000);
    forgetFlagDefinitions();
    query.mockResolvedValueOnce([definition("changed")]);
    expect(await flagDefinitions(NOW + 60_500)).toEqual([definition("changed")]);
    finish([definition("before the change")]);
    await settle();
    expect(await flagDefinitions(NOW + 61_000)).toEqual([definition("changed")]);
  });
});

describe("flags for a page", () => {
  it("are all off, without a read, for someone with no id", async () => {
    expect(await flagsFor(null, {})).toEqual({ values: {}, payloads: {} });
    expect(query).not.toHaveBeenCalled();
  });

  it("are evaluated for the person when there are flags", async () => {
    query.mockResolvedValue([
      {
        ...definition("staff-only"),
        conditions: [{ filters: [{ key: "staff", operator: "equals", value: true }], rollout: 100, variant: null }],
      },
      { ...definition("everyone"), payloads: { true: '{"hello":1}' } },
    ]);
    expect(await flagsFor("user-1", { staff: false })).toEqual({
      values: { "staff-only": false, everyone: true },
      payloads: { everyone: { hello: 1 } },
    });
  });

  it("can target what the server knows about someone", () => {
    expect(flagProperties(null, "GB", NOW)).toEqual({ signedIn: false, country: "GB" });
    const user = { _creationTime: NOW - 3.5 * 86_400_000, username: "ifiok", role: "admin" as const };
    expect(flagProperties(user, null, NOW)).toEqual({
      signedIn: true,
      username: "ifiok",
      accountDays: 3,
      staff: true,
    });
  });
});

describe("the flag form", () => {
  const fields: Record<string, string> = {
    key: " Wall-Order ",
    name: "Wall order",
    description: "Which slops come first.",
    variants: "control 1\nnewest 3\n",
    c0_rollout: "50",
    c0_f0_key: "signedIn",
    c0_f0_operator: "equals",
    c0_f0_value: "true",
    c0_f1_key: "accountDays",
    c0_f1_operator: "greaterThan",
    c0_f1_value: "7",
    c0_f2_key: "country",
    c0_f2_operator: "isSet",
    c0_f2_value: "ignored",
    c1_rollout: "100",
    c1_f0_key: "staff",
    c1_f0_operator: "nonsense",
    c1_variant: "Newest",
    c2_rollout: "",
    payloads: 'newest {"columns": 3}\n',
  };
  const get = (name: string) => fields[name] ?? "";

  it("reads variants, groups of people and payloads from plain fields", () => {
    expect(parseFlagForm(get)).toEqual({
      key: "wall-order",
      name: "Wall order",
      description: "Which slops come first.",
      variants: [
        { key: "control", weight: 1 },
        { key: "newest", weight: 3 },
      ],
      conditions: [
        {
          filters: [
            { key: "signedIn", operator: "equals", value: true },
            { key: "accountDays", operator: "greaterThan", value: 7 },
            { key: "country", operator: "isSet" },
          ],
          rollout: 50,
          variant: null,
        },
        // A comparison it doesn't know is left out, not guessed.
        { filters: [], rollout: 100, variant: "newest" },
      ],
      payloads: { newest: '{"columns": 3}' },
    });
  });

  it("takes an on-or-off flag's payload as one line", () => {
    const flag = parseFlagForm((name) => ({ key: "on", c0_rollout: "100", payloads: "[1, 2]" })[name] ?? "");
    expect(flag.variants).toBeNull();
    expect(flag.payloads).toEqual({ true: "[1, 2]" });
  });

  it("gives a saved flag back as the same fields", () => {
    const flag = parseFlagForm(get);
    expect(parseFlagForm((name) => flagFormValues(flag)[name] ?? "")).toEqual(flag);
  });

  it("says who gets a flag in a line", () => {
    expect(flagSummary(parseFlagForm(get))).toBe(
      "50% of signedIn is true and accountDays is more than 7 and country is set; everyone → newest · control/newest",
    );
    expect(flagSummary({ variants: null, conditions: [] })).toBe("nobody");
  });
});

describe("a visitor's analytics id", () => {
  const page = (headers: Record<string, string> = {}) =>
    new Request("https://slopper.day/", { headers: { accept: "text/html", ...headers } });

  it("is made on their first page, and read from the cookie after", () => {
    const minted = analyticsIdentity(page());
    expect(minted?.minted).toBe(true);
    expect(minted?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(analyticsIdentity(page({ cookie: "sa_id=abc" }))).toEqual({ id: "abc", minted: false });
    // Data requests and other methods wait for a page.
    expect(analyticsIdentity(new Request("https://slopper.day/wall.data"))).toBeNull();
    expect(analyticsIdentity(page({ cookie: "sa_off=1" }))).toBeNull();
  });

  it("is set on the page's response for the SDK to keep", async () => {
    const run = async (request: Request) => {
      const context = new RouterContextProvider();
      const response = await analyticsMiddleware(
        { request, context, params: {}, url: new URL(request.url), pattern: "/" },
        async () => new Response("the page"),
      );
      return { context, response: response instanceof Response ? response : new Response() };
    };
    const first = await run(page());
    const id = first.context.get(analyticsIdContext);
    expect(first.response.headers.get("set-cookie")).toBe(
      `sa_id=${id}; Max-Age=31536000; Path=/; Secure; SameSite=Lax`,
    );
    const later = await run(page({ cookie: `sa_id=${id}` }));
    expect(later.context.get(analyticsIdContext)).toBe(id);
    expect(later.response.headers.get("set-cookie")).toBeNull();
  });
});
