import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import { contentSecurityPolicy } from "~/.server/csp";
import { convexApp } from "./convexApp";
import { checkedLaunch } from "./launchFixtures";

/**
 * Security invariants: not proofs, but tripwires. Each one pins a rule the
 * audits established, so a change that breaks it has to say so here — the
 * point is that nothing regresses silently. Keep this file honest: when an
 * invariant genuinely changes, change it deliberately and say why.
 */

const ROOT = join(import.meta.dirname, "..");

/**
 * Public Convex functions that are open on purpose: bounded reads, nothing
 * more — each caps what it returns, and none takes a viewer. Anything added
 * here is a public API: treat it like one.
 */
const OPEN_FUNCTIONS = new Set(["tags.ts:popular", "slops.ts:card", "slops.ts:publicById", "goals.ts:standings"]);

function convexFiles(): string[] {
  return readdirSync(join(ROOT, "convex"))
    .filter((file) => file.endsWith(".ts") && file !== "tsconfig.json")
    .map((file) => join(ROOT, "convex", file));
}

describe("every public Convex function checks who is calling", () => {
  // A source scan: it proves a gate is called, not that it is called first or
  // correctly — but a new public function without any gate fails here, which
  // is the regression that matters.
  const GATES = /require[A-Z]\w*\(|isServer\(|viewer\(|readerFor/;

  it("mutations, queries and actions all name a gate", () => {
    const missing: string[] = [];
    for (const file of convexFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/export const (\w+) = (mutation|query|action)\(/g)) {
        const [, name] = match;
        if (OPEN_FUNCTIONS.has(`${file.split("/").pop()}:${name}`)) continue;
        // From this function's start to the next top-level close: its own
        // source, not whatever follows it in the file.
        const start = match.index ?? 0;
        const end = source.indexOf("\n});", start);
        const body = source.slice(start, end === -1 ? undefined : end);
        if (!GATES.test(body)) missing.push(`${file.split("/").pop()}: ${name}`);
      }
    }
    expect(
      missing,
      `add a gate (requireServer, viewer…) or, for a bounded public read, list it here:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the Content-Security-Policy keeps scripts on a nonce", () => {
  const policy = contentSecurityPolicy("thenonce", {
    convex: ["https://convex.example", "wss://convex.example"],
    frames: ["https://videos.example"],
  });

  it("allows scripts only from Slopper and the response's nonce", () => {
    expect(policy).toContain("script-src 'self' 'nonce-thenonce'");
    const scriptSrc = policy.split("; ").find((directive) => directive.startsWith("script-src"))!;
    const sources = scriptSrc.split(" ").slice(1);
    expect(sources).not.toContain("'unsafe-inline'");
    expect(sources).not.toContain("'unsafe-eval'");
    // WebAssembly for the Markdown editor compiles; JavaScript eval stays off.
    expect(sources).toContain("'wasm-unsafe-eval'");
  });

  it("keeps the doors closed that should stay closed", () => {
    for (const directive of [
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "worker-src 'self'",
    ]) {
      expect(policy, directive).toContain(directive);
    }
  });
});

describe("the one raw-HTML sink stays the sanitized markdown renderer", () => {
  it("no dangerouslySetInnerHTML anywhere else", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "packages/analytics/src"]) {
      const walk = (folder: string) => {
        for (const entry of readdirSync(join(ROOT, folder), { withFileTypes: true })) {
          const path = join(folder, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (/\.(ts|tsx)$/.test(entry.name) && !path.includes("_generated")) {
            if (readFileSync(join(ROOT, path), "utf8").includes("dangerouslySetInnerHTML")) offenders.push(path);
          }
        }
      };
      walk(dir);
    }
    // Shared.tsx renders app/lib/markdown.ts output, which escapes all raw
    // HTML. Anything else that wants raw HTML has to be reviewed into this
    // list with a sanitizer at its back.
    expect(offenders).toEqual(["app/components/Shared.tsx"]);
  });
});

describe("routes an anonymous visitor can reach have a ceiling", () => {
  it("each anonymous route that costs Convex work rate limits first", () => {
    const routes: [file: string, key: string][] = [
      ["app/routes/api.v1.ts", "api-pre:"],
      ["app/.server/agent/mcp.ts", "mcp-pre:"],
      ["app/routes/api.cli-login.ts", "cli-login:"],
      ["app/routes/api.cli-token.ts", "cli-token:"],
      ["app/routes/api.scheduled.ts", "scheduled:"],
      ["app/routes/api.traction.ts", "traction:"],
      ["app/routes/unsubscribe.tsx", "unsubscribe:"],
      ["app/routes/auth.start.ts", "oauth-start:"],
      ["app/routes/wall.tsx", "wall-search:"],
      ["app/routes/card.slop.ts", "card:"],
      ["app/routes/card.profile.ts", "card:"],
      ["app/routes/api.social.ts", "social:"],
      ["app/routes/api.social-metrics.ts", "social-metrics:"],
      ["app/routes/api.social-feeds.ts", "social-feeds:"],
      ["app/routes/api.studio-calendar.ts", "studio-calendar:"],
      ["app/routes/go.ts", "go:"],
      ["app/routes/review.tsx", "review:"],
      ["app/routes/api.auth-passkey.ts", "passkey:"],
      ["app/routes/login.verify.tsx", "two-factor:"],
    ];
    const missing = routes.filter(([file, key]) => !readFileSync(join(ROOT, file), "utf8").includes(key));
    expect(missing.map(([file]) => file)).toEqual([]);
  });
});

describe("the analytics ingest ceilings stay ceilings", () => {
  it("keeps the caps within an order of the audited values", async () => {
    const limits = (await import("../packages/analytics/src/component/lib/limits.ts")).INGEST_LIMITS;
    expect(limits.requestsPerMinute).toBeLessThanOrEqual(10_000);
    expect(limits.requestsPerDay).toBeLessThanOrEqual(1_000_000);
    expect(limits.requestsPerAddressPerMinute).toBeLessThanOrEqual(600);
    expect(limits.eventsPerMinute).toBeLessThanOrEqual(50_000);
    expect(limits.eventsPerDay).toBeLessThanOrEqual(5_000_000);
    expect(limits.eventsPerDistinctIdPerDay).toBeLessThanOrEqual(10_000);
    expect(limits.mergesPerAccountPerDay).toBeLessThanOrEqual(50);
    expect(limits.replayBytesPerDay).toBeLessThanOrEqual(50 * 1024 * 1024 * 1024);
    expect(limits.replayChunksPerMinute).toBeLessThanOrEqual(10_000);
  });
});

describe("uploads nothing attaches to are let go of", () => {
  it("marks media attached when content shows it, and sweeps the rest", async () => {
    vi.useFakeTimers();
    try {
      const t = convexApp();
      const server = t.withIdentity({ subject: "server" });
      const { userId } = await server.mutation(api.users.upsertFromIdentity, {
        provider: "e2e",
        providerId: "maker",
        preferredUsername: "maker",
        displayName: "Maker",
        avatarUrl: null,
        timeZone: "UTC",
      });
      // Two uploads: one a slop will show, one nothing ever will.
      const media = async () => {
        const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array([1])])));
        return await server.mutation(api.media.register, {
          ownerId: userId,
          location: { backend: "convex", storageId },
          contentType: "image/png",
          size: 1,
          check: { verdict: "ok", reason: "test" },
        });
      };
      const shown = await media();
      const forgotten = await media();
      const created = await checkedLaunch(server, {
        userId,
        input: {
          name: "Sweep me",
          tagline: "t",
          description: "",
          category: "games",
          links: [],
          screenshots: [shown.mediaId],
          madeWith: [],
        },
        launchNote: "",
      });
      // The sweep only takes uploads past their grace period.
      vi.advanceTimersByTime(15 * 86_400_000);
      await t.mutation(internal.media.sweepUnattached, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const kept = await server.query(api.slops.findForServer, { userId, ref: created.slug });
      expect(kept?.screenshots).toEqual([shown.mediaId]);
      // The never-attached one is gone; the slop's survives.
      expect(await server.query(api.media.url, { mediaId: forgotten.mediaId })).toBeNull();
      expect(await server.query(api.media.url, { mediaId: shown.mediaId })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
