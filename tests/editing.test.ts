import { describe, expect, it } from "vite-plus/test";
import { editableUntil, editWindow } from "~/lib/editing";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe("the edit window", () => {
  it("gives a late-night launch its full 12 hours into the next day", () => {
    const until = editableUntil({ launchedAt: at("2026-10-17T22:00:00Z"), launchDate: "2026-10-17" });
    expect(iso(until)).toBe("2026-10-18T10:00:00.000Z");
  });

  it("keeps a morning launch open for the rest of its launch day", () => {
    const until = editableUntil({ launchedAt: at("2026-10-17T08:00:00Z"), launchDate: "2026-10-17" });
    expect(iso(until)).toBe("2026-10-18T00:00:00.000Z");
  });

  it("ends the launch day at midnight UTC wherever the owner is", () => {
    // 9am in Los Angeles is 16:00 UTC: the UTC day ends 8 hours later, so 12 hours wins.
    const la = editableUntil({ launchedAt: at("2026-10-17T16:00:00Z"), launchDate: "2026-10-17" });
    expect(iso(la)).toBe("2026-10-18T04:00:00.000Z");
    // 8am on the 17th in Tokyo is still the 16th in UTC, the day it counts for.
    const tokyo = editableUntil({ launchedAt: at("2026-10-16T23:00:00Z"), launchDate: "2026-10-16" });
    expect(iso(tokyo)).toBe("2026-10-17T11:00:00.000Z");
    // Early in the UTC day: open until its midnight, whatever the clocks do somewhere.
    const london = editableUntil({ launchedAt: at("2026-10-25T02:00:00Z"), launchDate: "2026-10-25" });
    expect(iso(london)).toBe("2026-10-26T00:00:00.000Z");
  });
});

describe("what the owner is told", () => {
  it("says when editing closes on the owner's clock, then that it's locked", () => {
    const morning = { launchedAt: at("2026-10-17T08:00:00Z"), launchDate: "2026-10-17" };
    expect(editWindow(morning, "UTC", at("2026-10-17T15:00:00Z"))).toEqual({
      open: true,
      label: "Editable until midnight",
    });
    expect(editWindow(morning, "UTC", at("2026-10-18T00:00:00Z"))).toEqual({ open: false });

    // Out at 22:00 UTC: open until 10:00 the next day.
    const late = { launchedAt: at("2026-10-17T22:00:00Z"), launchDate: "2026-10-17" };
    expect(editWindow(late, "UTC", at("2026-10-17T22:30:00Z"))).toMatchObject({
      label: "Editable until 10:00 tomorrow",
    });
    expect(editWindow(late, "UTC", at("2026-10-18T09:00:00Z"))).toMatchObject({ label: "Editable until 10:00" });
    expect(editWindow(late, "UTC", at("2026-10-18T10:00:00Z"))).toEqual({ open: false });

    // 3pm in Los Angeles: open until 03:00 there the next day.
    const la = { launchedAt: at("2026-10-17T22:00:00Z"), launchDate: "2026-10-17" };
    expect(editWindow(la, "America/Los_Angeles", at("2026-10-18T03:00:00Z"))).toMatchObject({
      label: "Editable until 03:00 tomorrow",
    });

    // Out at 06:00 UTC, 8am in Lagos: the UTC midnight that ends the day is 1am there.
    const lagos = { launchedAt: at("2026-10-17T06:00:00Z"), launchDate: "2026-10-17" };
    expect(editWindow(lagos, "Africa/Lagos", at("2026-10-17T12:00:00Z"))).toMatchObject({
      label: "Editable until 01:00 tomorrow",
    });
  });
});
