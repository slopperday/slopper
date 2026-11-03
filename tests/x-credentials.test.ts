import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Id } from "@convex/_generated/dataModel";
import { xAuthorization, type XOwnCredentials } from "~/.server/social/x-credentials";
import { fetchXProfile, sealCredentials, xAdapter, type ConnectedAccount } from "~/.server/social/adapters";

const credentials: XOwnCredentials = {
  kind: "own-app",
  apiKey: "dpf43f3p2l4k3l03",
  apiSecret: "kd94hf93k423kf44",
  accessToken: "nnch734d00sl2jdk",
  accessTokenSecret: "pfkkdhi9sl3r4s00",
};

afterEach(() => vi.unstubAllGlobals());

describe("X credentials supplied by the maker", () => {
  it("matches the OAuth 1.0 reference signature, including query parameters", () => {
    const header = xAuthorization(
      credentials,
      "GET",
      "http://photos.example.net/photos?file=vacation.jpg&size=original",
      "kllo9940pd9333jh",
      "1191242096",
    );
    expect(header).toContain('oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"');
    expect(header).not.toContain(credentials.apiSecret);
    expect(header).not.toContain(credentials.accessTokenSecret);
  });

  it("verifies the token's actual account with signed user authentication", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { id: "123", username: "brand", name: "Brand" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchXProfile(credentials)).toEqual({ id: "123", username: "brand", name: "Brand" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.x.com/2/users/me?user.fields=profile_image_url");
    expect(init.headers.authorization).toMatch(/^OAuth /);
    expect(init.redirect).toBe("error");
  });

  it("never exposes provider error bodies containing submitted secrets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(credentials.apiSecret, { status: 401 })));
    await expect(fetchXProfile(credentials)).rejects.toThrow("X couldn't verify these credentials");
  });

  it("rejects malformed profile responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { id: "bad", username: "brand" } })));
    await expect(fetchXProfile(credentials)).rejects.toThrow("X didn't return an account");
  });

  it("publishes and reposts with sealed maker credentials without Slopper app keys", async () => {
    const sealed = await sealCredentials(credentials);
    expect(sealed).not.toContain(credentials.apiSecret);
    const account: ConnectedAccount = {
      _id: "account" as Id<"accounts">,
      _creationTime: 0,
      userId: "owner" as Id<"users">,
      provider: "x",
      remoteId: "123",
      handle: "brand",
      displayName: "Brand",
      avatarUrl: null,
      sealedCredentials: sealed,
      expiresAt: null,
      defaultMode: "post",
    };
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ data: { id: "456" } })));
    vi.stubGlobal("fetch", fetcher);
    const adapter = xAdapter();
    const post = await adapter.publish(account, {
      text: "Shipped",
      url: "https://slopper.day/@maker/product",
      title: "Product",
      description: "Hi",
      imageUrl: null,
    });
    await adapter.amplify!(account, post);
    expect(post.url).toBe("https://x.com/brand/status/456");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.x.com/2/tweets",
      "https://api.x.com/2/users/123/retweets",
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.headers.authorization).toMatch(/^OAuth /);
      expect(init.headers.authorization).toContain(`oauth_consumer_key="${credentials.apiKey}"`);
      expect(init.headers.authorization).not.toContain(credentials.apiSecret);
    }
  });
});
