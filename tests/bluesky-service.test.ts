import { describe, expect, it } from "vite-plus/test";
import { assertPublicService } from "~/.server/social/adapters";

/** A connected Bluesky PDS is a URL the server will keep talking to, so it may only be on the public internet. */
describe("a Bluesky PDS address", () => {
  it("accepts a public web address", async () => {
    await expect(assertPublicService("https://1.1.1.1")).resolves.toBeUndefined();
  });

  it("refuses what isn't a URL", async () => {
    await expect(assertPublicService("not a url")).rejects.toThrow("isn't a URL");
  });

  it("refuses other schemes, ports, credentials and private addresses", async () => {
    for (const service of [
      "ftp://bsky.social",
      "file:///etc/passwd",
      "https://bsky.social:8448",
      "https://me:secret@bsky.social",
      "http://127.0.0.1",
      "http://10.0.0.1",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
    ]) {
      await expect(assertPublicService(service), service).rejects.toThrow("public web");
    }
  });

  it("refuses a name that doesn't resolve to a public address", async () => {
    await expect(assertPublicService("https://pds.slopper.invalid")).rejects.toThrow("public internet");
  });
});
