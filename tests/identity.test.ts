import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  avatarExpires,
  facebookIdentity,
  fetchIdentity,
  githubIdentity,
  googleIdentity,
  linkedinIdentity,
  xIdentity,
} from "~/.server/auth/identity";
import * as oauth from "~/.server/auth/oauth";
import { authorizationUrl, exchangeCode, FACEBOOK_GRAPH_VERSION, parseIntent } from "~/.server/auth/oauth";
import { absoluteUrl, config } from "~/.server/config";
import { OAUTH_PROVIDERS } from "~/lib/model";

const client = { clientId: "client-id", clientSecret: "app-secret" };

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** Replaces `fetch` with one that records calls and answers `reply`. */
function fakeFetch(reply: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body instanceof URLSearchParams ? init.body.toString() : "",
    });
    return Response.json(reply, { status });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider profiles", () => {
  it("maps GitHub, keeping the handle and fixing bare websites", () => {
    expect(
      githubIdentity({
        id: 42,
        login: "Ifiok",
        name: null,
        avatar_url: "https://a.test/i.png",
        blog: "slop.day",
        bio: null,
      }),
    ).toEqual({
      provider: "github",
      providerId: "42",
      preferredUsername: "Ifiok",
      displayName: "Ifiok",
      avatarUrl: "https://a.test/i.png",
      bio: "",
      website: "https://slop.day",
      email: null,
    });
  });

  it("keeps GitHub's primary email only when GitHub verified it", () => {
    const user = { id: 42, login: "ifiok", name: null, avatar_url: "", blog: null, bio: null };
    const emails = [
      { email: "old@example.com", primary: false, verified: true },
      { email: "Ifiok@Example.com", primary: true, verified: true },
    ];
    expect(githubIdentity(user, emails).email).toBe("ifiok@example.com");
    expect(githubIdentity(user, [{ email: "ifiok@example.com", primary: true, verified: false }]).email).toBeNull();
  });

  it("suggests a Google username from the email, keeping the email only when Google verified it", () => {
    const profile = googleIdentity({ sub: "g-1", name: "Ada Lovelace", email: "ada.l@example.com" });
    expect(profile).toEqual({
      provider: "google",
      providerId: "g-1",
      preferredUsername: "ada.l",
      displayName: "Ada Lovelace",
      avatarUrl: null,
      email: null,
    });
    expect(JSON.stringify(profile)).not.toContain("example.com");
    expect(googleIdentity({ sub: "g-1", email: "ada.l@example.com", email_verified: true }).email).toBe(
      "ada.l@example.com",
    );
  });

  it("maps X by its stable id, with the handle as the username and a bigger avatar", () => {
    expect(
      xIdentity({
        id: "1234",
        username: "slopmaker",
        name: "Slop Maker",
        profile_image_url: "https://pbs.twimg.com/profile_images/1/abc_normal.jpg",
      }),
    ).toEqual({
      provider: "x",
      providerId: "1234",
      preferredUsername: "slopmaker",
      displayName: "Slop Maker",
      avatarUrl: "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
      email: null,
    });
    expect(xIdentity({ id: "9", username: "nameless", name: " " })).toMatchObject({
      displayName: "nameless",
      avatarUrl: null,
    });
  });

  it("maps LinkedIn's OpenID userinfo, falling back to the name without an email", () => {
    const withEmail = linkedinIdentity({
      sub: "li-1",
      name: "Grace Hopper",
      picture: "https://media.licdn.com/g.jpg",
      email: "grace@navy.example",
    });
    expect(withEmail).toEqual({
      provider: "linkedin",
      providerId: "li-1",
      preferredUsername: "grace",
      displayName: "Grace Hopper",
      avatarUrl: "https://media.licdn.com/g.jpg",
      email: null,
    });
    expect(JSON.stringify(withEmail)).not.toContain("navy.example");
    expect(linkedinIdentity({ sub: "li-1", email: "grace@navy.example", email_verified: true }).email).toBe(
      "grace@navy.example",
    );
    expect(linkedinIdentity({ sub: "li-2", given_name: "Grace", family_name: "Hopper" })).toMatchObject({
      preferredUsername: "Grace Hopper",
      displayName: "Grace Hopper",
    });
    expect(linkedinIdentity({ sub: "li-3" })).toMatchObject({
      preferredUsername: "slopper",
      displayName: "New slopper",
    });
  });

  it("maps Facebook, dropping the default silhouette", () => {
    expect(
      facebookIdentity({
        id: "fb-1",
        name: "Mark Slop",
        email: "mark@fb.example",
        picture: { data: { url: "https://platform-lookaside.fbsbx.com/p.jpg", is_silhouette: false } },
      }),
    ).toEqual({
      provider: "facebook",
      providerId: "fb-1",
      preferredUsername: "mark",
      displayName: "Mark Slop",
      avatarUrl: "https://platform-lookaside.fbsbx.com/p.jpg",
      // Facebook only shares confirmed addresses.
      email: "mark@fb.example",
    });
    expect(
      facebookIdentity({
        id: "fb-2",
        name: "No Email",
        picture: { data: { url: "https://x.test/s.jpg", is_silhouette: true } },
      }),
    ).toMatchObject({ preferredUsername: "No Email", avatarUrl: null });
  });
});

describe("profile pictures", () => {
  it("are copied, not linked, where the provider's links expire", () => {
    expect(OAUTH_PROVIDERS.filter(avatarExpires)).toEqual(["linkedin", "facebook"]);
  });
});

describe("fetching profiles", () => {
  it("reads X's /2/users/me envelope with the bearer token", async () => {
    const calls = fakeFetch({ data: { id: "7", username: "tilt", name: "Tilt" } });
    await expect(fetchIdentity("x", "user-token", client)).resolves.toMatchObject({ providerId: "7" });
    expect(calls[0].url).toBe("https://api.x.com/2/users/me?user.fields=profile_image_url,name,username");
    expect(calls[0].headers.get("authorization")).toBe("Bearer user-token");
  });

  it("asks GitHub for the profile and the verified emails with the same token", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(url);
      return Response.json(
        url.endsWith("/user/emails")
          ? [{ email: "gh@example.com", primary: true, verified: true }]
          : { id: 5, login: "gh", name: "GH", avatar_url: "", blog: null, bio: null },
      );
    });
    await expect(fetchIdentity("github", "user-token", client)).resolves.toMatchObject({
      providerId: "5",
      email: "gh@example.com",
    });
    expect(calls.sort()).toEqual(["https://api.github.com/user", "https://api.github.com/user/emails"]);
  });

  it("signs Facebook's Graph call with an app secret proof", async () => {
    const calls = fakeFetch({ id: "fb-9", name: "Proof" });
    await expect(fetchIdentity("facebook", "user-token", client)).resolves.toMatchObject({ providerId: "fb-9" });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me`);
    expect(url.searchParams.get("fields")).toBe("id,name,picture.type(large),email");
    expect(url.searchParams.get("appsecret_proof")).toBe(
      createHmac("sha256", "app-secret").update("user-token").digest("hex"),
    );
  });

  it("fails loudly when a provider refuses the profile request", async () => {
    fakeFetch({ error: "nope" }, 401);
    await expect(fetchIdentity("linkedin", "expired", client)).rejects.toThrow("api.linkedin.com failed (401)");
  });
});

describe("flows", () => {
  it("keeps bare /auth/x and /auth/linkedin connecting, and lets everyone sign in", () => {
    expect(parseIntent("x", null)).toBe("connect");
    expect(parseIntent("linkedin", null)).toBe("connect");
    // Google and Facebook sign in by default; they connect (YouTube, Pages and Instagram) only when asked.
    for (const provider of ["github", "google", "facebook"] as const) {
      expect(parseIntent(provider, null)).toBe("login");
    }
    expect(parseIntent("github", "connect")).toBeNull();
    expect(parseIntent("google", "connect")).toBe("connect");
    expect(parseIntent("facebook", "connect")).toBe("connect");
    // TikTok and Threads only connect: they never sign anyone in.
    for (const provider of ["tiktok", "threads"] as const) {
      expect(parseIntent(provider, null)).toBe("connect");
      expect(parseIntent(provider, "login")).toBeNull();
      expect(parseIntent(provider, "link")).toBeNull();
    }
    for (const provider of OAUTH_PROVIDERS) {
      expect(parseIntent(provider, "login")).toBe("login");
      expect(parseIntent(provider, "link")).toBe("link");
      expect(parseIntent(provider, "takeover")).toBeNull();
    }
  });

  async function authorize(provider: (typeof OAUTH_PROVIDERS)[number], intent: "login" | "link" | "connect") {
    const url = await authorizationUrl(provider, client, intent, "the-state", "v".repeat(64));
    return { url, params: url.searchParams };
  }

  it("asks X for read-only scopes to sign in, and posting scopes only to connect", async () => {
    const login = await authorize("x", "login");
    expect(login.url.origin + login.url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(login.params.get("scope")).toBe("users.read tweet.read");
    expect(login.params.get("redirect_uri")).toBe(absoluteUrl("/auth/x/callback"));
    expect(login.params.get("code_challenge_method")).toBe("S256");
    expect(login.params.get("state")).toBe("the-state");

    const connect = await authorize("x", "connect");
    expect(connect.params.get("scope")).toBe("tweet.read tweet.write users.read media.write offline.access");
    // One registered redirect URI whatever the flow.
    expect(connect.params.get("redirect_uri")).toBe(login.params.get("redirect_uri"));
    expect((await authorize("x", "link")).params.get("scope")).toBe("users.read tweet.read");
  });

  it("signs in to LinkedIn with OpenID Connect and connects with w_member_social", async () => {
    const login = await authorize("linkedin", "login");
    expect(login.params.get("scope")).toBe("openid profile email");
    expect(login.params.get("redirect_uri")).toBe(absoluteUrl("/auth/linkedin/callback"));
    expect(login.params.has("code_challenge")).toBe(false);
    expect((await authorize("linkedin", "connect")).params.get("scope")).toBe("openid profile w_member_social");
  });

  it("sends Facebook Login to the versioned dialog with PKCE", async () => {
    const { url, params } = await authorize("facebook", "login");
    expect(url.origin + url.pathname).toBe(`https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`);
    expect(params.get("scope")).toBe("public_profile email");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("client-id");
    expect(params.get("redirect_uri")).toBe(absoluteUrl("/auth/facebook/callback"));
    expect(params.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    // Connecting asks for the Pages and Instagram accounts to post as, at the same redirect URI.
    const connect = (await authorize("facebook", "connect")).params;
    expect(connect.get("scope")).toContain("pages_manage_posts");
    expect(connect.get("scope")).toContain("instagram_content_publish");
    expect(connect.get("redirect_uri")).toBe(params.get("redirect_uri"));
    await expect(authorizationUrl("github", client, "connect", "s", "v")).rejects.toThrow("can't do that");
  });

  it("connects YouTube with offline access, and TikTok with its client key and commas", async () => {
    const youtube = (await authorize("google", "connect")).params;
    expect(youtube.get("scope")).toContain("https://www.googleapis.com/auth/youtube.upload");
    expect(youtube.get("access_type")).toBe("offline");
    expect(youtube.get("prompt")).toBe("consent select_account");
    expect((await authorize("google", "login")).params.get("access_type")).toBeNull();

    const tiktok = (await authorizationUrl("tiktok", client, "connect", "s", "v")).searchParams;
    expect(tiktok.get("client_key")).toBe("client-id");
    expect(tiktok.has("client_id")).toBe(false);
    expect(tiktok.get("scope")).toBe("user.info.basic,video.publish,video.upload,video.list");
  });

  it("connects Reddit for good, and LinkedIn Pages only once they're turned on", async () => {
    const reddit = (await authorizationUrl("reddit", client, "connect", "s", "v")).searchParams;
    expect(reddit.get("scope")).toBe("identity submit read edit history mysubreddits");
    expect(reddit.get("duration")).toBe("permanent");
    expect(reddit.get("redirect_uri")).toBe(absoluteUrl("/auth/reddit/callback"));
    await expect(authorizationUrl("reddit", client, "login", "s", "v")).rejects.toThrow("can't do that");

    const pages = config.linkedinPages;
    try {
      config.linkedinPages = false;
      expect((await authorizationUrl("linkedin", client, "connect", "s", "v")).searchParams.get("scope")).not.toContain(
        "w_organization_social",
      );
      config.linkedinPages = true;
      const scope = (await authorizationUrl("linkedin", client, "connect", "s", "v")).searchParams.get("scope");
      expect(scope).toContain("w_member_social");
      expect(scope).toContain("w_organization_social");
      expect((await authorizationUrl("linkedin", client, "login", "s", "v")).searchParams.get("scope")).not.toContain(
        "w_organization_social",
      );
    } finally {
      config.linkedinPages = pages;
    }
  });

  it("trades a Facebook code with the secret in the body, never the URL", async () => {
    const calls = fakeFetch({ access_token: "fb-token", token_type: "bearer", expires_in: 5_183_944 });
    const tokens = await exchangeCode("facebook", client, "the-code", "the-verifier");
    expect(tokens.accessToken).toBe("fb-token");
    expect(tokens.refreshToken).toBeNull();
    expect(calls[0].url).toBe(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`);
    expect(calls[0].method).toBe("POST");
    const body = new URLSearchParams(calls[0].body);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: absoluteUrl("/auth/facebook/callback"),
      code_verifier: "the-verifier",
      client_id: "client-id",
      client_secret: "app-secret",
    });
  });

  it("reports Facebook's error objects and X's basic-auth token errors", async () => {
    fakeFetch({ error: { message: "This authorization code has expired.", type: "OAuthException", code: 100 } }, 400);
    await expect(exchangeCode("facebook", client, "old", "v")).rejects.toThrow(
      "Facebook token request failed: This authorization code has expired.",
    );
    const calls = fakeFetch(
      { error: "invalid_request", error_description: "Value passed for the token was invalid." },
      400,
    );
    await expect(exchangeCode("x", client, "bad", "v")).rejects.toThrow("Value passed for the token was invalid.");
    expect(calls[0].headers.get("authorization")).toBe(`Basic ${btoa("client-id:app-secret")}`);
  });
});

describe("post-login destinations", () => {
  it("allow same-site paths, and nothing that could leave the site", () => {
    const { safeReturnTo } = oauth;
    expect(safeReturnTo("/wall")).toBe("/wall");
    for (const value of [
      null,
      "",
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example/",
      "\\evil.example/",
      "javascript:alert(1)",
    ]) {
      expect(safeReturnTo(value), String(value)).toBe("/");
    }
    // Browsers strip tabs and newlines out of URLs: "/\t//evil.example" still
    // leaves the site, so control characters never survive.
    for (const value of ["/\t//evil.example/", "/\n//evil.example/", "/\r//evil.example/", "/\x7f", "/\x00"]) {
      expect(safeReturnTo(value), JSON.stringify(value)).toBe("/");
    }
  });
});
