import { describe, expect, it } from "vite-plus/test";
import { isListed, loadConfig } from "~/.server/config";

describe("ADMIN_IDENTITIES", () => {
  it("lists sign-in accounts as provider:id", () => {
    expect(loadConfig({}).adminIdentities).toEqual([]);
    expect(loadConfig({ ADMIN_IDENTITIES: " GitHub:1160934 , x:44196397,," }).adminIdentities).toEqual([
      { provider: "github", providerId: "1160934" },
      { provider: "x", providerId: "44196397" },
    ]);
    // Ids are kept as given: some providers' ids are case-sensitive.
    expect(loadConfig({ ADMIN_IDENTITIES: "google:AbC" }).adminIdentities).toEqual([
      { provider: "google", providerId: "AbC" },
    ]);
  });

  it("stops the server for an entry that isn't provider:id, like a username", () => {
    for (const value of ["ifiokjr", "github:", ":1160934"]) {
      expect(() => loadConfig({ ADMIN_IDENTITIES: value })).toThrow("ADMIN_IDENTITIES entries are provider:id");
    }
  });

  it("matches both the provider and its id", () => {
    const listed = loadConfig({ ADMIN_IDENTITIES: "github:1160934" }).adminIdentities;
    expect(isListed(listed, { provider: "github", providerId: "1160934" })).toBe(true);
    expect(isListed(listed, { provider: "x", providerId: "1160934" })).toBe(false);
    expect(isListed(listed, { provider: "github", providerId: "116093" })).toBe(false);
  });
});
