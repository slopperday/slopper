import { describe, expect, it } from "vite-plus/test";
import { MOTION_COOKIE, motionCookie, parseMotion } from "~/lib/motion";

/** The motion setting as a cookie: what's read back, and what's written. */

describe("motion", () => {
  it("reads only the two choices, and anything else as following the device", () => {
    expect(parseMotion("reduce")).toBe("reduce");
    expect(parseMotion("full")).toBe("full");
    for (const other of [undefined, null, "", "none", "REDUCE"]) expect(parseMotion(other)).toBeNull();
  });

  it("keeps a choice for a year, and clears it to follow the device again", () => {
    expect(motionCookie("reduce")).toBe(`${MOTION_COOKIE}=reduce; path=/; samesite=lax; max-age=31536000`);
    expect(motionCookie(null)).toBe(`${MOTION_COOKIE}=; path=/; samesite=lax; max-age=0`);
  });
});
