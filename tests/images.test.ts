import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { loadConfig } from "~/.server/config";
import { fixedImage, fluidImage, isResizable, RESIZABLE_IMAGES, resized } from "~/lib/images";

const SHOT = "https://f002.backblazeb2.com/file/slopper-media/screenshots/abc.png";

/** `remote_images` from netlify.toml, as the regexes Netlify matches. */
function netlifyRemoteImages(): string[] {
  const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  const block = /remote_images\s*=\s*\[([\s\S]*?)\n\]/.exec(toml)?.[1] ?? "";
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

describe("resized pictures", () => {
  it("allows the same hosts as netlify.toml", () => {
    const allowed = netlifyRemoteImages().map((source) => new RegExp(`^${source}$`));
    expect(allowed).toHaveLength(RESIZABLE_IMAGES.length);
    for (const url of [
      SHOT,
      "https://f004.backblazeb2.com/file/slopper-media/avatars/x.jpg",
      "https://avatars.githubusercontent.com/u/1160934?v=4",
      "https://lh3.googleusercontent.com/a/abc=s96-c",
      "https://pbs.twimg.com/profile_images/1/x_normal.jpg",
    ]) {
      expect(isResizable(url), url).toBe(true);
      expect(
        allowed.some((pattern) => pattern.test(url)),
        url,
      ).toBe(true);
    }
    for (const url of [
      "https://f002.backblazeb2.com/file/someone-else/x.png",
      "https://evil.example/https://avatars.githubusercontent.com/x",
      "http://127.0.0.1:3210/api/storage/abc",
    ]) {
      expect(isResizable(url), url).toBe(false);
      expect(
        allowed.some((pattern) => pattern.test(url)),
        url,
      ).toBe(false);
    }
  });

  it("goes through the Image CDN only when it's on and the host is allowed", () => {
    expect(resized(SHOT, { w: 80, h: 80, fit: "cover", position: "top" }, true)).toBe(
      `/.netlify/images?url=${encodeURIComponent(SHOT)}&w=80&h=80&fit=cover&position=top`,
    );
    expect(resized(SHOT, { w: 80 }, false)).toBe(SHOT);
    expect(resized("http://127.0.0.1:3210/api/storage/abc", { w: 80 }, true)).toBe(
      "http://127.0.0.1:3210/api/storage/abc",
    );
  });

  it("offers twice the size for sharp screens", () => {
    const image = fixedImage(SHOT, { h: 192 }, true);
    expect(image.src).toContain("h=192");
    expect(image.srcSet).toBe(`${image.src} 1x, ${resized(SHOT, { h: 384 }, true)} 2x`);
    expect(fixedImage(SHOT, { h: 192 }, false)).toEqual({ src: SHOT });
  });

  it("lists widths for pictures that follow the layout", () => {
    const image = fluidImage(SHOT, "100vw", true, 960);
    expect(image.sizes).toBe("100vw");
    expect(image.srcSet?.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["320w", "480w", "640w", "960w"]);
    expect(image.src).toContain("w=960");
    expect(fluidImage(SHOT, "100vw", false)).toEqual({ src: SHOT });
  });

  it("is on in Netlify Functions unless IMAGE_CDN says otherwise", () => {
    expect(loadConfig({}).imageCdn).toBe(false);
    expect(loadConfig({ IMAGE_CDN: "netlify" }).imageCdn).toBe(true);
    const global = globalThis as { Netlify?: unknown };
    global.Netlify = {};
    try {
      expect(loadConfig({}).imageCdn).toBe(true);
      expect(loadConfig({ IMAGE_CDN: "off" }).imageCdn).toBe(false);
    } finally {
      delete global.Netlify;
    }
  });
});
