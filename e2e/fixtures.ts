import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { type BrowserContext, expect, type Page, test as base } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { importJWK, type JWK, SignJWT } from "jose";
import { cookieNames, stateKey } from "@slopperday/analytics/shared";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel";
import { hashToken, randomToken } from "../app/.server/encoding.ts";
import type { CategoryId } from "../app/lib/model.ts";
import type { FakeObject } from "./fake-s3.ts";
import {
  E2E_ADMIN,
  E2E_ADMIN_IDENTITY,
  type FakeCheckRequest,
  type FakeEmail,
  STACK_FILE,
  type Stack,
} from "./ports.ts";

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

/** Enough of a person to vote as them. */
export type SeededVoter = Pick<SeededUser, "id" | "username">;

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
  /** "games" unless a test says otherwise. */
  category?: CategoryId;
  /** The content check verdict to record; "ok" unless a test says otherwise. */
  verdict?: "ok" | "mature" | "blocked" | null;
}

export interface Seed {
  /** A person with a live session. Usernames are unique per test. */
  user(prefix?: string, options?: { email?: string }): Promise<SeededUser>;
  /**
   * The admin the stack lists in ADMIN_IDENTITIES, with a fresh session, made
   * an admin as the app server does when they sign in.
   */
  admin(): Promise<SeededUser>;
  /** A new moderator, made so by the admin as /mod/team would. */
  moderator(): Promise<SeededUser>;
  /** Trusts `user`'s promo videos, as approving their first one would. */
  trust(user: SeededUser): Promise<void>;
  /** A launch by `owner`, entered into today's race. */
  slop(owner: SeededUser, options?: SlopOptions): Promise<SeededSlop>;
  /**
   * A launch by `owner` that went out at `launchedAt`, imported with its
   * creation time, since no function can backdate a document.
   */
  pastSlop(owner: SeededUser, launchedAt: number): Promise<SeededSlop>;
  /**
   * `count` people who joined two days ago, so their votes count in the race
   * (`LIMITS.raceVoterAge`). Imported with their creation time, since no
   * function can backdate a document; they vote, but can't sign in.
   */
  voters(count: number): Promise<SeededVoter[]>;
  /** A browser page signed in as `user`, in its own context. */
  pageAs(user: SeededUser): Promise<Page>;
  /** A browser page for a visitor, in its own context. */
  visitorPage(): Promise<Page>;
  vote(user: SeededVoter, slop: SeededSlop, value: 1 | -1): Promise<void>;
  /** A personal API token for `user`, as /settings/api makes them. */
  apiToken(user: SeededUser): Promise<string>;
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
/**
 * Picks a radio drawn as a card. The input itself is visually hidden (`sr-only`), so a forced click on it lands on
 * whatever sits under its 1px box and sometimes changes nothing. Click the card, as people do, and check it took.
 */
export async function choose(page: Page, name: string | RegExp): Promise<void> {
  const radio = page.getByRole("radio", { name });
  await radio.locator("xpath=ancestor::label[1]").click();
  await expect(radio).toBeChecked();
}

export function runInternal(stack: Stack, name: string, args: Record<string, unknown>): void {
  convexCli(stack, ["run", name, JSON.stringify(args)]);
}

/** The Convex CLI, pointed at the stack's backend with its admin key. Returns what it printed. */
function convexCli(stack: Stack, args: string[]): string {
  return execFileSync("node_modules/.bin/convex", args, {
    stdio: "pipe",
    env: {
      ...process.env,
      CONVEX_DEPLOYMENT: "",
      CONVEX_SELF_HOSTED_URL: stack.convexUrl,
      CONVEX_SELF_HOSTED_ADMIN_KEY: stack.adminKey,
    },
  }).toString("utf8");
}

/**
 * The visitor's analytics id, once the SDK is running in the page. The id
 * cookie alone says nothing: the server sets it on the first page, and the
 * SDK only loads after the load event. The SDK keeps its state in
 * localStorage from its first event, so that's the sign it's listening.
 */
export async function analyticsIdOf(page: Page): Promise<string> {
  await page.waitForFunction((key) => localStorage.getItem(key) !== null, stateKey());
  const id = (await page.context().cookies()).find((cookie) => cookie.name === cookieNames().distinctId)?.value;
  if (!id) throw new Error("The analytics SDK is running without an id cookie.");
  return id;
}

/** One event as the analytics component stores it (packages/analytics). */
export interface AnalyticsEvent {
  name: string;
  distinctId: string;
  sessionId: string | null;
  path: string | null;
  properties: Record<string, unknown>;
}

/** The analytics component's latest events for a person, by any of their ids, newest first. */
export function analyticsEvents(stack: Stack, distinctId: string): AnalyticsEvent[] {
  const args = JSON.stringify({ distinctId, limit: 200 });
  return JSON.parse(convexCli(stack, ["run", "--component", "analytics", "events:recent", args])) as AnalyticsEvent[];
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
    // The project's device (a phone for the mobile project): contexts made by hand don't inherit it.
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
    const newContext = () =>
      browser.newContext({
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        baseURL: stack.appUrl,
        timezoneId: "UTC",
      });

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
        const user = await signIn(E2E_ADMIN_IDENTITY.providerId, E2E_ADMIN, "Moderator");
        if (user.username !== E2E_ADMIN) throw new Error(`The moderator was seeded as @${user.username}.`);
        await convex.mutation(api.team.bootstrap, E2E_ADMIN_IDENTITY);
        return user;
      },

      async moderator() {
        const admin = await seed.admin();
        const moderator = await seed.user("mod");
        await convex.mutation(api.team.setRole, { adminId: admin.id, username: moderator.username, role: "moderator" });
        return moderator;
      },

      async trust(user) {
        const admin = await seed.admin();
        await convex.mutation(api.videos.setTrust, { adminId: admin.id, userId: user.id, trusted: true });
      },

      async slop(
        owner,
        { name, tagline = "Made for the e2e tests", description = "", category = "games", verdict = "ok" } = {},
      ) {
        const title = name ?? `Slop ${unique()}`;
        const created = await convex.mutation(api.slops.create, {
          userId: owner.id,
          input: {
            name: title,
            tagline,
            description,
            category,
            links: [{ kind: "website", url: "https://example.com/" }],
            screenshots: [],
            madeWith: [],
          },
          launchNote: tagline,
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

      async pastSlop(owner, launchedAt) {
        const name = `Old slop ${unique()}`;
        const slug = name.toLowerCase().replaceAll(" ", "-");
        // Launch dates are UTC dates.
        const launchDate = new Date(launchedAt).toISOString().slice(0, 10);
        const document = {
          _creationTime: launchedAt,
          userId: owner.id,
          productId: null,
          launchLabel: null,
          slug,
          name,
          tagline: "Launched a while ago",
          description: "",
          category: "games",
          nsfw: false,
          links: [{ kind: "website", url: "https://example.com/" }],
          screenshots: [],
          madeWith: [],
          launchDate,
          raceDate: launchDate,
          goalId: null,
          goalDay: null,
          goalLength: null,
          number: 900_000 + randomBytes(2).readUInt16BE(),
          upvotes: 0,
          downvotes: 0,
          commentCount: 0,
          updateCount: 0,
          fieldTests: 0,
          backers: 0,
          pledged: 0,
          lastActivityAt: launchedAt,
          slopOfTheDay: null,
          slopcessfulAt: null,
          slopcessfulNote: null,
          crosspost: {},
          moneyPublic: false,
          hidden: false,
          check: { verdict: "ok", reason: "Seeded", checkedAt: launchedAt },
        };
        const dir = mkdtempSync(join(tmpdir(), "slopper-e2e-"));
        try {
          const file = join(dir, "slops.jsonl");
          writeFileSync(file, `${JSON.stringify(document)}\n`);
          convexCli(stack, ["import", "--table", "slops", "--append", "--yes", file]);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        const slop = await convex.query(api.slops.findForServer, { userId: owner.id, ref: slug });
        if (!slop) throw new Error(`The imported slop ${slug} isn't there.`);
        return { id: slop._id, slug, name, path: `/@${owner.username}/${slug}` };
      },

      async voters(count) {
        const joined = Date.now() - 2 * 86_400_000;
        const usernames = Array.from({ length: count }, () => `voter-${unique()}`.slice(0, 30));
        const rows = usernames.map((username) => ({
          _creationTime: joined,
          username,
          displayName: "Voter",
          avatarUrl: null,
          bio: "",
          website: null,
          timeZone: "UTC",
          showNsfw: false,
        }));
        const dir = mkdtempSync(join(tmpdir(), "slopper-e2e-"));
        try {
          const file = join(dir, "users.jsonl");
          writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
          convexCli(stack, ["import", "--table", "users", "--append", "--yes", file]);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        return await Promise.all(
          usernames.map(async (username) => {
            const profile = await convex.query(api.users.profile, { username });
            if (!profile) throw new Error(`The imported voter ${username} isn't there.`);
            return { id: profile.owner.id, username };
          }),
        );
      },

      async pageAs(user) {
        const context = await newContext();
        contexts.push(context);
        await context.addCookies([{ name: SESSION_COOKIE, value: user.token, url: stack.appUrl }]);
        return await context.newPage();
      },

      async visitorPage() {
        const context = await newContext();
        contexts.push(context);
        return await context.newPage();
      },

      async vote(user, slop, value) {
        await convex.mutation(api.slops.vote, { userId: user.id, slopId: slop.id, value });
      },

      async apiToken(user) {
        const token = `slp_${randomToken(32)}`;
        await convex.mutation(api.tokens.create, {
          userId: user.id,
          name: "e2e",
          preview: token.slice(0, 10),
          hash: await hashToken(token),
        });
        return token;
      },
    };

    await provide(seed);
    for (const context of contexts) await context.close();
  },
});

export { expect };
