// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "enableIframePageLoading": true } }
import { describe, expect, it } from "vite-plus/test";
import { createReplayer } from "@slopperday/analytics/player";

/**
 * Anyone can store recording chunks (`/a/r` is public, within its ceilings),
 * and admins replay them — so nothing in a recording may be able to run.
 * rrweb's defenses (script→noscript, on* renames) miss some vectors
 * (onerror, iframe srcdoc, meta refresh survive into the rebuilt DOM
 * verbatim), which makes the replay iframe's sandbox the load-bearing wall:
 * `allow-same-origin` alone, never `allow-scripts`. This pins it. If a
 * rrweb upgrade or a player change lets scripts run here, this fails.
 */
describe("the replay player's iframe", () => {
  it("never allows scripts in a recording", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const events = [
      { type: 4, data: { href: "https://slopper.day/", width: 1200, height: 800 }, timestamp: 0 },
      {
        type: 2,
        data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } },
        timestamp: 1,
      },
    ] as Parameters<typeof createReplayer>[1];
    const replayer = createReplayer(root, events);
    replayer.pause(0);
    expect(replayer.iframe.getAttribute("sandbox")).toBe("allow-same-origin");
    // A hostile full snapshot reaches the DOM — inert, because of the sandbox.
    expect(root.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-same-origin");
    replayer.destroy();
  });
});
