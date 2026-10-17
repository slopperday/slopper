import { describe, expect, it } from "vite-plus/test";
import { portBase } from "../e2e/ports.ts";

describe("e2e ports", () => {
  it("gives each checkout its own stable block, below the ephemeral ports", () => {
    const main = portBase("/code/slopper", undefined);
    expect(portBase("/code/slopper", undefined)).toBe(main);
    expect(portBase("/code/slopper/.claude/worktrees/tidy-otter", undefined)).not.toBe(main);
    for (const checkout of ["/a", "/b", "/code/slopper", "/Users/me/slopper-worktrees/feat-x"]) {
      const base = portBase(checkout, undefined);
      expect(base % 10).toBe(0);
      expect(base).toBeGreaterThanOrEqual(20_000);
      expect(base + 4).toBeLessThan(30_000);
    }
  });

  it("takes a base by hand, and refuses one that isn't a usable port", () => {
    expect(portBase("/code/slopper", "4173")).toBe(4173);
    for (const bad of ["80", "65530", "4173.5", "next"]) {
      expect(() => portBase("/code/slopper", bad)).toThrow("E2E_PORT_BASE must be a port");
    }
  });
});
