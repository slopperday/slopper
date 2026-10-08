import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { type BrowserContext, expect, type Page, test as base } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { importJWK, type JWK, SignJWT } from "jose";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel";
import { hashToken, randomToken } from "../app/.server/encoding.ts";
import type { FakeObject } from "./fake-s3.ts";
import { E2E_ADMIN, type FakeCheckRequest, type FakeEmail, STACK_FILE, type Stack } from "./ports.ts";

/**
 * Shared setup for the journeys. Tests that aren't about signing in start
 * signed in through a seeded session, and tests that aren't about launching
 * seed their slops straight into Convex, as the app server would.
 */

/** The app's session cookie (app/.server/http.ts). */
const SESSION_COOKIE = "slopper_session";

export interface SeededUser {
  id: Id<"users">;
  username: string;
  /** The raw session token, as the browser holds it. */
  token: string;
}

export interface SeededSlop {
  id: Id<"slops">;
  slug: string;
  name: string;
  path: string;
}

interface SlopOptions {
  name?: string;
  tagline?: string;
  description?: string;
  /** The content check verdict to record; "ok" unless a test says otherwise. */
  verdict?: "ok" | "mature" | "blocked" | null;
}

export interface Seed {
  /** A person with a live session. Usernames are unique per test. */
  user(prefix?: string, options?: { email?: string }): Promise<SeededUser>;
  /** The one moderator the stack trusts (ADMIN_USERNAMES), with a fresh session. */
  admin(): Promise<SeededUser>;
  /** A launch by `owner`, entered into today's race. */
  slop(owner: SeededUser, options?: SlopOptions): Promise<SeededSlop>;
  /** A browser page signed in as `user`, in its own context. */
  pageAs(user: SeededUser): Promise<Page>;
  /** A browser page for a visitor, in its own context. */
  visitorPage(): Promise<Page>;
  vote(user: SeededUser, slop: SeededSlop, value: 1 | -1): Promise<void>;
}

async function serverClient(stack: Stack): Promise<ConvexHttpClient> {
  const jwk = JSON.parse(Buffer.from(stack.privateKey, "base64").toString("utf8")) as JWK;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
    .setSubject("server")
    .setIssuer(stack.issuer)
    .setAudience("convex")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(await importJWK(jwk, "ES256"));
  const client = new ConvexHttpClient(stack.convexUrl);
  client.setAuth(token);
  return client;
}

/** Runs an internal Convex function with the stack's admin key, like the cron would. */
export function runInternal(stack: Stack, name: string, args: Record<string, unknown>): void {
  execFileSync("node_modules/.bin/convex", ["run", name, JSON.stringify(args)], {
    stdio: "ignore",
    env: {
      ...process.env,
      CONVEX_DEPLOYMENT: "",
      CONVEX_SELF_HOSTED_URL: stack.convexUrl,
      CONVEX_SELF_HOSTED_ADMIN_KEY: stack.adminKey,
    },
  });
}

/** What the fake content check has been asked so far. */
export async function checkRequests(stack: Stack): Promise<FakeCheckRequest[]> {
  return (await (await fetch(`${stack.checkUrl}/__requests`)).json()) as FakeCheckRequest[];
}

/** Every email the fake Resend has been handed so far. */
export async function sentEmails(stack: Stack): Promise<FakeEmail[]> {
  return (await (await fetch(`${stack.checkUrl}/__emails`)).json()) as FakeEmail[];
}

/** What the fake B2 bucket holds right now. */
export async function bucketObjects(stack: Stack): Promise<FakeObject[]> {
  return (await (await fetch(`${stack.s3Url}/__objects`)).json()) as FakeObject[];
}

export const test = base.extend<{ seed: Seed }, { stack: Stack; convex: ConvexHttpClient }>({
  stack: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern.
    async ({}, provide) => {
      await provide(JSON.parse(readFileSync(STACK_FILE, "utf8")) as Stack);
    },
    { scope: "worker" },
  ],
  convex: [
    async ({ stack }, provide) => {
      await provide(await serverClient(stack));
    },
    { scope: "worker" },
  ],
  seed: async ({ browser, convex, stack }, provide, testInfo) => {
    const contexts: BrowserContext[] = [];
    const unique = () => `${testInfo.workerIndex}${randomBytes(3).toString("hex")}`;

    async function signIn(
      providerId: string,
      username: string,
      displayName: string,
      email: string | null = null,
    ): Promise<SeededUser> {
      const { userId } = await convex.mutation(api.users.upsertFromIdentity, {
        provider: "e2e",
        providerId,
        preferredUsername: username,
        displayName,
        avatarUrl: null,
        timeZone: "UTC",
        email,
      });
      const token = randomToken();
      await convex.mutation(api.users.createSession, {
        userId,
        tokenHash: await hashToken(token),
        expiresAt: Date.now() + 86_400_000,
      });
      const user = await convex.query(api.users.resolveSession, { tokenHash: await hashToken(token) });
      if (!user) throw new Error("The seeded session didn't resolve.");
      return { id: userId, username: user.username, token };
    }

    const seed: Seed = {
      async user(prefix = "slopper", { email } = {}) {
        const name = `${prefix}-${unique()}`.slice(0, 30);
        return await signIn(name, name, prefix[0].toUpperCase() + prefix.slice(1), email ?? null);
      },

      async admin() {
        const user = await signIn("admin", E2E_ADMIN, "Moderator");
        if (user.username !== E2E_ADMIN) throw new Error(`The moderator was seeded as @${user.username}.`);
        return user;
      },

      async slop(owner, { name, tagline = "Made for the e2e tests", description = "", verdict = "ok" } = {}) {
        const title = name ?? `Slop ${unique()}`;
        const created = await convex.mutation(api.slops.create, {
          userId: owner.id,
          input: {
            name: title,
            tagline,
            description,
            category: "games",
            links: [{ kind: "website", url: "https://example.com/" }],
            screenshots: [],
            madeWith: [],
          },
          launchNote: tagline,
          today: new Date().toISOString().slice(0, 10),
        });
        if (verdict) {
          await convex.mutation(api.moderation.applyCheck, {
            slopId: created.slopId,
            scope: "slop",
            verdict,
            reason: "Seeded",
          });
        }
        return { id: created.slopId, slug: created.slug, name: title, path: `/@${owner.username}/${created.slug}` };
      },

      async pageAs(user) {
        const context = await browser.newContext({ baseURL: stack.appUrl, timezoneId: "UTC" });
        contexts.push(context);
        await context.addCookies([{ name: SESSION_COOKIE, value: user.token, url: stack.appUrl }]);
        return await context.newPage();
      },

      async visitorPage() {
        const context = await browser.newContext({ baseURL: stack.appUrl, timezoneId: "UTC" });
        contexts.push(context);
        return await context.newPage();
      },

      async vote(user, slop, value) {
        await convex.mutation(api.slops.vote, { userId: user.id, slopId: slop.id, value });
      },
    };

    await provide(seed);
    for (const context of contexts) await context.close();
  },
});

export { expect };
