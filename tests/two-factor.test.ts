// @vitest-environment edge-runtime
import { describe, expect, it } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  codeFor,
  decodeBase32,
  encodeBase32,
  matchTotp,
  newRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUrl,
} from "~/.server/auth/totp";
import { convexApp } from "./convexApp";

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}
type Server = ReturnType<typeof setup>["server"];

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

// RFC 6238's test secret, "12345678901234567890" in ASCII.
const RFC_SECRET = encodeBase32(new TextEncoder().encode("12345678901234567890"));

describe("authenticator app codes", () => {
  it("matches RFC 6238's test vectors (SHA-1, last six digits)", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(codeFor(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(codeFor(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(codeFor(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(codeFor(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("accepts the step either side of now, and nothing else", () => {
    const now = 1_234_567_890_000;
    const step = Math.floor(now / 30_000);
    expect(matchTotp(RFC_SECRET, codeFor(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, codeFor(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, codeFor(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, codeFor(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "12345", now)).toBeNull();
    expect(
      matchTotp(RFC_SECRET, `${codeFor(RFC_SECRET, step).slice(0, 3)} ${codeFor(RFC_SECRET, step).slice(3)}`, now),
    ).toBe(step);
  });

  it("round-trips base32 and makes an address apps read", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
    expect(otpauthUrl("ABCD", "@maker")).toBe(
      "otpauth://totp/Slopper%3A%40maker?secret=ABCD&issuer=Slopper&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("makes ten distinct recovery codes, compared without dashes or case", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(normalizeRecoveryCode(" AB2C-dE3f ")).toBe("ab2cde3f");
  });
});

describe("two-step sign-in in Convex", () => {
  it("is required once an app is confirmed, and each code's step works once", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    await server.mutation(api.security.startTotp, { userId, sealedSecret: "sealed" });
    expect(await server.query(api.security.required, { userId })).toBe(false);
    expect(await server.mutation(api.security.useTotpStep, { userId, step: 100 })).toBe(true);
    expect(await server.query(api.security.required, { userId })).toBe(true);
    // The same code, or an older one, can't be used again.
    expect(await server.mutation(api.security.useTotpStep, { userId, step: 100 })).toBe(false);
    expect(await server.mutation(api.security.useTotpStep, { userId, step: 99 })).toBe(false);
    expect(await server.mutation(api.security.useTotpStep, { userId, step: 101 })).toBe(true);
    await expect(server.mutation(api.security.startTotp, { userId, sealedSecret: "other" })).rejects.toThrow(
      "already set up",
    );
  });

  it("throws a step away after five tries, and slows a person down across steps", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const make = (tokenHash: string) =>
      server.mutation(api.security.createChallenge, {
        tokenHash,
        kind: "login",
        userId,
        returnTo: "/",
        ttlMs: 600_000,
      });
    await make("a");
    for (let i = 0; i < 5; i++) expect((await server.mutation(api.security.attempt, { tokenHash: "a" })).ok).toBe(true);
    expect(await server.mutation(api.security.attempt, { tokenHash: "a" })).toEqual({ ok: false, reason: "expired" });
    expect(await server.query(api.security.challenge, { tokenHash: "a" })).toBeNull();
    await make("b");
    for (let i = 0; i < 5; i++) expect((await server.mutation(api.security.attempt, { tokenHash: "b" })).ok).toBe(true);
    await make("c");
    // Ten tries in a quarter of an hour, whichever steps they're on.
    expect(await server.mutation(api.security.attempt, { tokenHash: "c" })).toEqual({ ok: false, reason: "slow" });
  });

  it("refuses a passkey whose counter goes backwards, as a cloned key would", async () => {
    const { t, server } = setup();
    const userId = await makeUser(server, "maker");
    await server.mutation(api.security.addPasskey, {
      userId,
      credentialId: "cred",
      publicKey: "key",
      counter: 5,
      transports: ["internal"],
      name: "MacBook",
    });
    expect(await server.query(api.security.required, { userId })).toBe(true);
    const key = (await server.query(api.security.passkeyByCredential, { credentialId: "cred" }))!;
    expect(await server.mutation(api.security.usePasskey, { passkeyId: key._id, counter: 6 })).toBe(true);
    expect(await server.mutation(api.security.usePasskey, { passkeyId: key._id, counter: 6 })).toBe(false);
    await expect(
      server.mutation(api.security.addPasskey, {
        userId,
        credentialId: "cred",
        publicKey: "k",
        counter: 0,
        transports: [],
        name: "x",
      }),
    ).rejects.toThrow("already added");
    const events = await t.run(async (ctx) => await ctx.db.query("securityEvents").collect());
    expect(events.map((event) => event.kind)).toContain("passkey-clone");
  });

  it("spends recovery codes once, and drops them when the last factor goes", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    await server.mutation(api.security.addPasskey, {
      userId,
      credentialId: "c",
      publicKey: "k",
      counter: 0,
      transports: [],
      name: "Key",
    });
    await server.mutation(api.security.setRecoveryCodes, { userId, hashes: ["h1", "h2"] });
    expect(await server.mutation(api.security.useRecoveryCode, { userId, hash: "h1" })).toBe(true);
    expect(await server.mutation(api.security.useRecoveryCode, { userId, hash: "h1" })).toBe(false);
    expect((await server.query(api.security.factors, { userId })).recoveryLeft).toBe(1);
    const [key] = (await server.query(api.security.factors, { userId })).passkeys;
    await server.mutation(api.security.removePasskey, { userId, passkeyId: key.id });
    const after = await server.query(api.security.factors, { userId });
    expect(after).toMatchObject({ enabled: false, recoveryLeft: 0 });
    expect((await server.query(api.security.events, { userId })).map((event) => event.kind)).toContain(
      "two-factor-off",
    );
  });

  it("knows when a session last proved itself, and signs out everywhere else", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const expiresAt = Date.now() + 86_400_000;
    await server.mutation(api.users.createSession, { userId, tokenHash: "mine", expiresAt, verifiedAt: Date.now() });
    await server.mutation(api.users.createSession, { userId, tokenHash: "old", expiresAt });
    expect(await server.query(api.security.sessionVerifiedAt, { tokenHash: "old" })).toBe(0);
    await server.mutation(api.security.markVerified, { tokenHash: "old" });
    expect(await server.query(api.security.sessionVerifiedAt, { tokenHash: "old" })).toBeGreaterThan(0);
    const sessions = await server.query(api.security.sessions, { userId, currentHash: "mine" });
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    expect(await server.mutation(api.security.endOtherSessions, { userId, keepHash: "mine" })).toBe(1);
    expect(await server.query(api.users.resolveSession, { tokenHash: "old" })).toBeNull();
    expect(await server.query(api.users.resolveSession, { tokenHash: "mine" })).not.toBeNull();
  });
});
