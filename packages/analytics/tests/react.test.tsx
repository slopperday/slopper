// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AnalyticsOptions } from "../src/browser/client";
import {
  AnalyticsProvider,
  afterLoad,
  type FlagState,
  landedAt,
  useAnalytics,
  useFeatureFlag,
  useFeatureFlagEnabled,
  useFeatureFlagPayload,
  useIdentify,
} from "../src/react";

/**
 * The provider keeps the SDK out of the page's first load: it imports it
 * only after the load event, when the browser is idle. The SDK is a fake
 * here, to see when it's made and what with.
 */

const made: { options: AnalyticsOptions; identified: string[]; flagsSeen: string[]; shutdown: boolean }[] = [];

vi.mock("../src/browser/client", () => ({
  Analytics: class {
    readonly record: (typeof made)[number];
    constructor(options: AnalyticsOptions) {
      this.record = { options, identified: [], flagsSeen: [], shutdown: false };
      made.push(this.record);
    }
    get identified() {
      return this.record.identified.length > 0;
    }
    identify(distinctId: string) {
      this.record.identified.push(distinctId);
    }
    reset() {}
    flagSeen(flag: string, value: boolean | string) {
      this.record.flagsSeen.push(`${flag}:${String(value)}`);
    }
    shutdown() {
      this.record.shutdown = true;
    }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let idle: (() => void)[] = [];
let readyState: DocumentReadyState = "loading";

function Status() {
  const client = useAnalytics();
  useIdentify({ distinctId: "user-1" });
  return <p>{client ? "loaded" : "waiting"}</p>;
}

function render(options: AnalyticsOptions | null) {
  act(() => {
    root.render(
      <AnalyticsProvider options={options}>
        <Status />
      </AnalyticsProvider>,
    );
  });
}

/** Lets the dynamic import settle and React apply what came of it. */
async function settle() {
  await act(async () => {
    for (let round = 0; round < 5; round += 1) await Promise.resolve();
    await new Promise((done) => setTimeout(done, 0));
  });
}

beforeEach(() => {
  made.length = 0;
  idle = [];
  readyState = "loading";
  vi.spyOn(document, "readyState", "get").mockImplementation(() => readyState);
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => idle.push(callback));
  vi.stubGlobal("cancelIdleCallback", () => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AnalyticsProvider", () => {
  it("loads the SDK only after the page has loaded and the browser is idle", async () => {
    render({ endpoint: "https://x.convex.site/a" });
    await settle();
    expect(made).toHaveLength(0);
    expect(idle).toHaveLength(0);
    expect(container.textContent).toBe("waiting");

    readyState = "complete";
    window.dispatchEvent(new Event("load"));
    expect(idle).toHaveLength(1);
    await settle();
    expect(made).toHaveLength(0);

    act(() => idle[0]?.());
    await settle();
    expect(made).toHaveLength(1);
    expect(made[0]?.options.endpoint).toBe("https://x.convex.site/a");
    expect(container.textContent).toBe("loaded");
    // Hooks waiting on the SDK run once it's there.
    expect(made[0]?.identified).toEqual(["user-1"]);
  });

  it("loads nothing inside a frame, where a page is a preview, not a visit", async () => {
    readyState = "complete";
    vi.spyOn(window, "top", "get").mockReturnValue(null);
    render({ endpoint: "https://x.convex.site/a" });
    expect(idle).toHaveLength(0);
    await settle();
    expect(made).toHaveLength(0);
  });

  it("waits only for idle when the page has already loaded", async () => {
    readyState = "complete";
    render({ endpoint: "https://x.convex.site/a" });
    expect(idle).toHaveLength(1);
    act(() => idle[0]?.());
    await settle();
    expect(made).toHaveLength(1);
  });

  it("loads nothing when analytics is off, or if the page goes before the SDK is needed", async () => {
    render(null);
    readyState = "complete";
    window.dispatchEvent(new Event("load"));
    await settle();
    expect(idle).toHaveLength(0);

    render({ endpoint: "https://x.convex.site/a" });
    act(() => root.unmount());
    root = createRoot(container);
    for (const callback of idle) act(() => callback());
    await settle();
    expect(made).toHaveLength(0);
  });

  it("makes one client per endpoint, however often the options object changes", async () => {
    readyState = "complete";
    render({ endpoint: "https://x.convex.site/a" });
    act(() => idle[0]?.());
    await settle();
    render({ endpoint: "https://x.convex.site/a", properties: { country: "GB" } });
    await settle();
    expect(made).toHaveLength(1);
    render({ endpoint: "https://y.convex.site/a" });
    act(() => idle.at(-1)?.());
    await settle();
    expect(made).toHaveLength(2);
    expect(made[0]?.shutdown).toBe(true);
  });
});

describe("afterLoad", () => {
  it("falls back to a timer where requestIdleCallback doesn't exist", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    readyState = "complete";
    const task = vi.fn();
    afterLoad(task);
    expect(task).not.toHaveBeenCalled();
    await new Promise((done) => setTimeout(done, 5));
    expect(task).toHaveBeenCalledOnce();
  });

  it("can be cancelled before it runs", () => {
    const task = vi.fn();
    const cancel = afterLoad(task);
    cancel();
    readyState = "complete";
    window.dispatchEvent(new Event("load"));
    for (const callback of idle) callback();
    expect(task).not.toHaveBeenCalled();
  });
});

describe("landedAt", () => {
  it("is when the page was opened, while the address is still the one it landed on", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ name: location.href } as unknown as PerformanceEntry]);
    vi.spyOn(performance, "timeOrigin", "get").mockReturnValue(1_792_300_000_000.4);
    expect(landedAt()).toBe(1_792_300_000_000);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "http://localhost:3000/elsewhere" } as unknown as PerformanceEntry,
    ]);
    expect(landedAt()).toBeUndefined();
  });
});

describe("feature flags", () => {
  const FLAGS: FlagState = {
    values: { "wall-order": "newest", "new-wall": true, "old-thing": false },
    payloads: { "wall-order": { columns: 3 } },
  };

  function Flags() {
    const order = useFeatureFlag("wall-order");
    const wall = useFeatureFlagEnabled("new-wall");
    const old = useFeatureFlagEnabled("old-thing");
    const unknown = useFeatureFlag("never-made");
    const payload = useFeatureFlagPayload("wall-order");
    return <p>{JSON.stringify({ order, wall, old, unknown, payload })}</p>;
  }

  it("reads the server's values on the first render, before the SDK is there", () => {
    act(() => {
      root.render(
        <AnalyticsProvider options={{ endpoint: "https://x.convex.site/a" }} flags={FLAGS}>
          <Flags />
        </AnalyticsProvider>,
      );
    });
    expect(JSON.parse(container.textContent ?? "")).toEqual({
      order: "newest",
      wall: true,
      old: false,
      unknown: false,
      payload: { columns: 3 },
    });
    expect(made).toHaveLength(0);
  });

  it("reports what was seen once the SDK loads, and works with analytics off", async () => {
    readyState = "complete";
    act(() => {
      root.render(
        <AnalyticsProvider options={{ endpoint: "https://x.convex.site/a" }} flags={FLAGS}>
          <Flags />
        </AnalyticsProvider>,
      );
    });
    act(() => idle[0]?.());
    await settle();
    // useFeatureFlagPayload reads its flag too, and the SDK sends each value once a session.
    expect(made[0]?.flagsSeen).toEqual(
      expect.arrayContaining(["wall-order:newest", "new-wall:true", "old-thing:false", "never-made:false"]),
    );

    act(() => {
      root.render(
        <AnalyticsProvider options={null} flags={FLAGS}>
          <Flags />
        </AnalyticsProvider>,
      );
    });
    expect(JSON.parse(container.textContent ?? "")).toMatchObject({ order: "newest", wall: true });
  });
});
