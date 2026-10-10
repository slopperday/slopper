import { describe, expect, it } from "vite-plus/test";
import { withOwnQuery } from "~/.server/http";
import { withoutRedirectMarker } from "~/lib/redirect";

describe("redirects on Netlify", () => {
  it("gives a bare target an empty query when the request had one", () => {
    expect(withOwnQuery("https://slopper.day/auth/github/callback?code=c&state=s", "/")).toBe("/?_");
    expect(withOwnQuery("https://slopper.day/auth/github/callback?code=c", "/goal#start")).toBe("/goal?_#start");
  });

  it("leaves targets alone when there's nothing to copy or they have a query", () => {
    expect(withOwnQuery("https://slopper.day/new", "/")).toBeNull();
    expect(withOwnQuery("https://slopper.day/settings?tab=1", "/login?returnTo=%2Fsettings")).toBeNull();
    expect(
      withOwnQuery("https://slopper.day/auth/github?intent=login", "https://github.com/login/oauth/authorize?x=1"),
    ).toBeNull();
  });

  it("the page drops the marker and keeps everything else", () => {
    expect(withoutRedirectMarker("https://slopper.day/?_")).toBe("/");
    expect(withoutRedirectMarker("https://slopper.day/goal?_&tab=2#start")).toBe("/goal?tab=2#start");
    expect(withoutRedirectMarker("https://slopper.day/wall?page=2")).toBeNull();
  });
});
