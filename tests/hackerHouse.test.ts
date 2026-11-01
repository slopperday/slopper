// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import {
  HACKER_HOUSE,
  HACKER_HOUSE_MODES,
  hackerHouseActive,
  hackerHouseMode,
  countsForHackerHouse,
} from "~/lib/hackerHouse";
import { cleanTags, matchTags, tagOptions } from "~/lib/tags";
import { convexApp } from "./convexApp";
import { checkedLaunch } from "./launchFixtures";

describe("Solana Hacker House", () => {
  it("runs for November 1–12 inclusive, only in 2026", () => {
    expect(hackerHouseActive(HACKER_HOUSE.start - 1)).toBe(false);
    expect(hackerHouseActive(HACKER_HOUSE.start)).toBe(true);
    expect(hackerHouseActive(HACKER_HOUSE.end - 1)).toBe(true);
    expect(hackerHouseActive(HACKER_HOUSE.end)).toBe(false);
    expect(hackerHouseActive(Date.parse("2027-11-01"))).toBe(false);
    expect(HACKER_HOUSE_MODES.map((mode) => mode.target)).toEqual([3, 6, 10]);
    expect(hackerHouseMode("intense")?.target).toBe(10);
    expect(hackerHouseMode("invalid")).toBeNull();
  });

  it("offers a canonical tag during the event and preserves it afterwards", () => {
    expect(cleanTags(["solana hackerhouse", "Solana Hacker House"])).toEqual([HACKER_HOUSE.tag]);
    expect(matchTags(tagOptions([], HACKER_HOUSE.start), "hacker", [])[0]?.name).toBe(HACKER_HOUSE.tag);
    for (const now of [HACKER_HOUSE.start - 1, HACKER_HOUSE.end]) {
      expect(
        tagOptions([{ name: HACKER_HOUSE.tag, uses: 100 }], now).some((tag) => tag.name === HACKER_HOUSE.tag),
      ).toBe(false);
    }
    expect(cleanTags([HACKER_HOUSE.tag])).toEqual([HACKER_HOUSE.tag]);
  });

  it("counts tagged original apps, excluding other dates and relaunches", () => {
    const app = { _id: "app", _creationTime: HACKER_HOUSE.start, madeWith: [HACKER_HOUSE.tag] };
    expect(countsForHackerHouse(app)).toBe(true);
    expect(countsForHackerHouse({ ...app, productId: "app" })).toBe(true);
    expect(countsForHackerHouse({ ...app, productId: "original" })).toBe(false);
    expect(countsForHackerHouse({ ...app, madeWith: ["Solana"] })).toBe(false);
    expect(countsForHackerHouse({ ...app, _creationTime: HACKER_HOUSE.end })).toBe(false);
  });

  it("keeps progress private, respects moderation, and stops after the deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HACKER_HOUSE.start + 60_000);
    try {
      const t = convexApp();
      const server = t.withIdentity({ subject: "server" });
      const person = async (name: string) =>
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
      const userId = await person("maker");
      const otherId = await person("other");
      const input = {
        name: "App",
        tagline: "A live app",
        description: "",
        category: "tools",
        links: [{ kind: "website" as const, url: "https://example.com" }],
        screenshots: [],
        madeWith: [HACKER_HOUSE.tag],
      };
      await checkedLaunch(server, { userId, input, launchNote: "" });
      await checkedLaunch(server, { userId: otherId, input, launchNote: "" });
      await checkedLaunch(server, { userId: otherId, input: { ...input, name: "Second app" }, launchNote: "" });
      // An unchecked app stays held, so it cannot inflate progress.
      await server.mutation(api.slops.create, { userId, input: { ...input, name: "Held" }, launchNote: "" });
      const args = { since: HACKER_HOUSE.start - 1 };
      expect((await server.query(api.home.feed, { ...args, asUser: userId })).hackerHouse?.shipped).toBe(1);
      expect((await t.query(api.home.feed, { ...args, asUser: userId })).hackerHouse?.shipped).toBe(0);
      const other = t.withIdentity({ subject: otherId });
      expect((await other.query(api.home.feed, { ...args, asUser: userId })).hackerHouse?.shipped).toBe(2);
      vi.setSystemTime(HACKER_HOUSE.end);
      expect((await server.query(api.home.feed, { ...args, asUser: userId })).hackerHouse).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
