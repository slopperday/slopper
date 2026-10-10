import { describe, expect, it } from "vite-plus/test";
import { listWords } from "~/lib/display";
import { parseGoalForm, parseLinks, parseSlopForm, validateSlop } from "~/.server/forms";
import { deriveKey, seal, unseal } from "~/.server/crypto";
import { safeReturnTo } from "~/.server/auth/oauth";
import { sniffImageType } from "~/.server/media";
import { renderMarkdown } from "~/lib/markdown";
import { formatMoney, moneyTotals, parseAmount } from "~/lib/money";
import { normalizeUsername, slugify, usernameProblem } from "~/lib/username";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("slop validation", () => {
  it("keeps store links on their store's domain", () => {
    expect(parseLinks(["testflight"], ["https://example.com/join/abc"]).error).toBe(
      "TestFlight beta links live on testflight.apple.com.",
    );
    const ok = parseLinks(
      ["website", "testflight", "play_beta"],
      ["my-slop.app", "https://testflight.apple.com/join/AbC", "https://play.google.com/apps/testing/com.slop"],
    );
    expect(ok.error).toBeNull();
    expect(ok.links[0]).toEqual({ kind: "website", url: "https://my-slop.app/" });
    expect(parseLinks(["website"], ["javascript:alert(1)"]).links).toEqual([]);
    expect(parseLinks(["website"], [""]).error).toBe("Add at least one link so people can try it.");
  });

  it("reports every problem at once", () => {
    const result = parseSlopForm(form([["category", "nope"]]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["category", "links", "name", "tagline"]);
  });

  it("normalises tags and drops ids that can't be media", () => {
    const result = validateSlop({
      name: " TiltMaze ",
      tagline: "Tilt to play",
      category: "games",
      links: [{ kind: "website", url: "https://tiltmaze.app" }],
      screenshots: ["md74hc9mbbvqr2v5z7hq53s03x8fsgxx", "../../etc/passwd"],
      madeWith: ["Claude Code", "Flutter", "", "Claude Code"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("TiltMaze");
    expect(result.value.screenshots).toEqual(["md74hc9mbbvqr2v5z7hq53s03x8fsgxx"]);
    expect(result.value.madeWith).toEqual(["Claude Code", "Flutter"]);
  });

  it("turns days and a pace into a goal, lets typed numbers win and guards start dates", () => {
    const today = "2026-10-06";
    const hardcore = parseGoalForm(
      form([
        ["days", "30"],
        ["pace", "hardcore"],
      ]),
      today,
    );
    expect(hardcore).toEqual({
      ok: true,
      value: { title: "30 slops in 30 days", target: 30, days: 30, startDate: today },
    });
    const paced = (days: string, pace: string) => {
      const result = parseGoalForm(
        form([
          ["days", days],
          ["pace", pace],
        ]),
        today,
      );
      return result.ok ? result.value.target : null;
    };
    expect([paced("10", "safe"), paced("10", "steady"), paced("10", "impossible"), paced("7", "safe")]).toEqual([
      2, 5, 20, 1,
    ]);

    const custom = parseGoalForm(
      form([
        ["days", "30"],
        ["customDays", "14"],
        ["pace", "hardcore"],
        ["target", "10"],
      ]),
      today,
    );
    expect(custom.ok && [custom.value.target, custom.value.days]).toEqual([10, 14]);
    // Other days still drive the pace.
    const otherDays = parseGoalForm(
      form([
        ["days", "30"],
        ["customDays", "12"],
        ["pace", "steady"],
      ]),
      today,
    );
    expect(otherDays.ok && [otherDays.value.target, otherDays.value.days]).toEqual([6, 12]);

    const noPace = parseGoalForm(form([["days", "30"]]), today);
    expect(noPace.ok ? null : noPace.errors.target).toBe("Pick how many slops you will ship.");
    const past = parseGoalForm(
      form([
        ["days", "7"],
        ["pace", "hardcore"],
        ["startDate", "2026-10-01"],
      ]),
      today,
    );
    expect(past.ok ? null : past.errors.startDate).toBe("Start today or later.");
  });
});

describe("safety", () => {
  it("escapes HTML in Markdown and refuses dangerous links", () => {
    const html = renderMarkdown(
      "<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://a.dev) ![pic](https://a.dev/p.png)",
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://a.dev/"');
    expect(html).toContain('rel="nofollow ugc noopener"');
  });

  it("round-trips sealed credentials and detects tampering", async () => {
    const key = await deriveKey("test-secret");
    const sealed = await seal('{"token":"abc"}', key);
    expect(await unseal(sealed, key)).toBe('{"token":"abc"}');
    const [version, iv, body] = sealed.split(".");
    const flipped = body.slice(0, -2) + (body.endsWith("A") ? "BB" : "AA");
    await expect(unseal(`${version}.${iv}.${flipped}`, key)).rejects.toThrow();
    await expect(unseal(sealed, await deriveKey("other-secret"))).rejects.toThrow();
  });

  it("keeps post-login redirects on this site", () => {
    expect(safeReturnTo("/@me/slop")).toBe("/@me/slop");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("/\\evil.com")).toBe("/");
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });

  it("recognises images by their bytes, not their name", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
  });
});

describe("money", () => {
  it("parses amounts into cents", () => {
    expect(parseAmount("12.99")).toBe(1299);
    expect(parseAmount("12,99")).toBe(1299);
    expect(parseAmount("1,299.00")).toBe(129900);
    expect(parseAmount("10")).toBe(1000);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("ten")).toBeNull();
  });

  it("totals per currency without converting", () => {
    expect(
      moneyTotals([
        { kind: "cost", amount: 1299, currency: "USD" },
        { kind: "revenue", amount: 5000, currency: "USD" },
        { kind: "cost", amount: 300, currency: "GBP" },
      ]),
    ).toEqual([
      { currency: "USD", spent: 1299, made: 5000, net: 3701 },
      { currency: "GBP", spent: 300, made: 0, net: -300 },
    ]);
    expect(formatMoney(1299, "USD")).toBe("$12.99");
    expect(formatMoney(250, "SOL")).toBe("2.50 SOL");
  });
});

describe("names", () => {
  it("normalises usernames and slugs", () => {
    expect(normalizeUsername("@Ifiok Jr!")).toBe("ifiok-jr");
    expect(usernameProblem("today")).toBe("That name is reserved.");
    expect(usernameProblem("ok_name")).toBeNull();
    expect(slugify("Tîlt Maze: 2.0!")).toBe("tilt-maze-2-0");
  });
});

describe("copy", () => {
  it("names one, two or three networks the way a person would", () => {
    expect(listWords(["Bluesky"], "or")).toBe("Bluesky");
    expect(listWords(["LinkedIn", "Bluesky"], "or")).toBe("LinkedIn or Bluesky");
    expect(listWords(["X", "LinkedIn", "Bluesky"], "and")).toBe("X, LinkedIn and Bluesky");
  });
});
