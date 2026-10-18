// @vitest-environment edge-runtime
import { describe, expect, it } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { facebookIdentity, type IdentityProfile, linkedinIdentity, xIdentity } from "~/.server/auth/identity";
import { convexApp } from "./convexApp";

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

type Server = ReturnType<typeof setup>["server"];

async function signIn(server: Server, profile: Omit<IdentityProfile, "email">) {
  return await server.mutation(api.users.upsertFromIdentity, { ...profile, timeZone: "UTC" });
}

async function githubUser(server: Server, id: string): Promise<Id<"users">> {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "github",
    providerId: id,
    preferredUsername: `gh-${id}`,
    displayName: "GitHub person",
    avatarUrl: null,
    timeZone: "UTC",
  });
  return userId;
}

async function providers(server: Server, userId: Id<"users">): Promise<string[]> {
  return (await server.query(api.users.identities, { userId })).sort();
}

describe("new accounts from new providers", () => {
  it("takes usernames from the handle or name, normalised and suffixed on a clash", async () => {
    const { server } = setup();
    const x = await signIn(server, xIdentity({ id: "1", username: "Slop_Maker" }));
    const linkedin = await signIn(server, linkedinIdentity({ sub: "a", name: "Ada Lovelace" }));
    const facebook = await signIn(server, facebookIdentity({ id: "f", name: "Ada Lovelace" }));
    const usernames = await Promise.all(
      [x, linkedin, facebook].map(async ({ userId }) => (await server.query(api.users.get, { userId }))?.username),
    );
    expect(usernames).toEqual(["slop_maker", "ada-lovelace", "ada-lovelace-2"]);
    expect([x.created, linkedin.created, facebook.created]).toEqual([true, true, true]);
  });
});

describe("linking sign-in methods", () => {
  it("lands a linked provider's sign-in on the same account", async () => {
    const { server } = setup();
    const userId = await githubUser(server, "1");
    const linked = await server.mutation(api.users.linkIdentity, { userId, provider: "x", providerId: "x-1" });
    expect(linked).toEqual({ ok: true, alreadyLinked: false });
    expect(await providers(server, userId)).toEqual(["github", "x"]);

    const viaX = await signIn(server, xIdentity({ id: "x-1", username: "someone-else" }));
    expect(viaX).toEqual({ userId, created: false });
    // Linking again changes nothing.
    expect(await server.mutation(api.users.linkIdentity, { userId, provider: "x", providerId: "x-1" })).toEqual({
      ok: true,
      alreadyLinked: true,
    });
  });

  it("refuses an identity that already signs in to a different account", async () => {
    const { server } = setup();
    const mine = await githubUser(server, "1");
    const theirs = await signIn(server, facebookIdentity({ id: "fb-1", name: "Them" }));
    expect(
      await server.mutation(api.users.linkIdentity, { userId: mine, provider: "facebook", providerId: "fb-1" }),
    ).toEqual({ ok: false, reason: "other_account" });
    // Theirs stays theirs.
    expect(await signIn(server, facebookIdentity({ id: "fb-1", name: "Them" }))).toEqual({
      userId: theirs.userId,
      created: false,
    });
    expect(await providers(server, mine)).toEqual(["github"]);
  });

  it("keeps one identity per provider on an account", async () => {
    const { server } = setup();
    const userId = await githubUser(server, "1");
    expect(await server.mutation(api.users.linkIdentity, { userId, provider: "github", providerId: "2" })).toEqual({
      ok: false,
      reason: "provider_linked",
    });
  });

  it("never unlinks the last way in, and an unlinked provider signs in somewhere new", async () => {
    const { server } = setup();
    const userId = await githubUser(server, "1");
    expect(await server.mutation(api.users.unlinkIdentity, { userId, provider: "github" })).toEqual({
      ok: false,
      reason: "last_method",
    });
    expect(await server.mutation(api.users.unlinkIdentity, { userId, provider: "linkedin" })).toEqual({
      ok: false,
      reason: "not_linked",
    });

    await server.mutation(api.users.linkIdentity, { userId, provider: "linkedin", providerId: "li-1" });
    expect(await server.mutation(api.users.unlinkIdentity, { userId, provider: "github" })).toEqual({ ok: true });
    expect(await providers(server, userId)).toEqual(["linkedin"]);
    expect(await server.mutation(api.users.unlinkIdentity, { userId, provider: "linkedin" })).toEqual({
      ok: false,
      reason: "last_method",
    });

    const viaGitHub = await signIn(server, {
      provider: "github",
      providerId: "1",
      preferredUsername: "gh-1",
      displayName: "GitHub person",
      avatarUrl: null,
    });
    expect(viaGitHub.created).toBe(true);
    expect(viaGitHub.userId).not.toBe(userId);
  });

  it("is only for the Slopper server", async () => {
    const { t, server } = setup();
    const userId = await githubUser(server, "1");
    const asPerson = t.withIdentity({ subject: userId });
    await expect(
      asPerson.mutation(api.users.linkIdentity, { userId, provider: "x", providerId: "x-1" }),
    ).rejects.toThrow("Only the Slopper server");
    await expect(asPerson.mutation(api.users.unlinkIdentity, { userId, provider: "github" })).rejects.toThrow(
      "Only the Slopper server",
    );
    await expect(asPerson.query(api.users.identities, { userId })).rejects.toThrow("Only the Slopper server");
    await expect(
      asPerson.mutation(api.users.setAvatar, { userId, avatarUrl: "https://evil.example/a.png" }),
    ).rejects.toThrow("Only the Slopper server");
  });
});
