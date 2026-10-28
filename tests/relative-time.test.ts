// @vitest-environment happy-dom
import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server.edge";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { RelativeTime, RenderTimeProvider } from "~/components/RelativeTime";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.replaceChildren();
});

it.each([
  [120_000, "1m", "2m"],
  [3_600_000, "59m", "1h"],
  [86_400_000, "23h", "1d"],
  [8 * 86_400_000, "27 Oct", "27 Oct"],
] as const)("hydrates an age at %i ms without a clock or time-zone mismatch", async (boundary, before, after) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("TZ", "UTC");
  const at = Date.UTC(2026, 9, 27, 0, 30);
  const renderedAt = at + boundary - 100;
  const tree = createElement(RenderTimeProvider, { renderedAt, children: createElement(RelativeTime, { at }) });
  const container = document.createElement("div");
  const errors: unknown[] = [];
  document.body.append(container);
  vi.setSystemTime(renderedAt);
  container.innerHTML = renderToString(tree);
  expect(container.textContent).toBe(before);

  vi.stubEnv("TZ", "America/Los_Angeles");
  vi.setSystemTime(at + boundary + 100);
  await act(async () => {
    root = hydrateRoot(container, tree, { onRecoverableError: (error) => errors.push(error) });
  });

  expect(container.textContent).toBe(after);
  expect(errors).toEqual([]);
});
