import { describe, expect, it } from "vite-plus/test";
import { editableUntil, editWindow } from "~/lib/editing";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe("the edit window", () => {
  it("gives a late-night launch its full 12 hours into the next day", () => {
    const until = editableUntil({ launchedAt: at("2026-10-17T22:00:00Z"), launchDate: "2026-10-17" }, "UTC");
    expect(iso(until)).toBe("2026-10-18T10:00:00.000Z");
  });

  it("keeps a morning launch open for the rest of its launch day", () => {
    const until = editableUntil({ launchedAt: at("2026-10-17T08:00:00Z"), launchDate: "2026-10-17" }, "UTC");
    expect(iso(until)).toBe("2026-10-18T00:00:00.000Z");
  });

  it("ends the launch day at the owner's midnight, not UTC's", () => {
    // 9am in Los Angeles: the day ends at midnight there, 07:00 UTC.
    const la = editableUntil(
      { launchedAt: at("2026-10-17T16:00:00Z"), launchDate: "2026-10-17" },
      "America/Los_Angeles",
    );
    expect(iso(la)).toBe("2026-10-18T07:00:00.000Z");
    // 8am on the 17th in Tokyo is still the 16th in UTC; the Tokyo day is the one that counts.
    const tokyo = editableUntil({ launchedAt: at("2026-10-16T23:00:00Z"), launchDate: "2026-10-17" }, "Asia/Tokyo");
    expect(iso(tokyo)).toBe("2026-10-17T15:00:00.000Z");
    // 11pm in Tokyo: 12 hours wins.
    const late = editableUntil({ launchedAt: at("2026-10-17T14:00:00Z"), launchDate: "2026-10-17" }, "Asia/Tokyo");
    expect(iso(late)).toBe("2026-10-18T02:00:00.000Z");
  });

  it("follows the clocks on days they change", () => {
    // London's 25 October 2026 is 25 hours long: it ends at midnight GMT.
    const autumn = editableUntil({ launchedAt: at("2026-10-25T08:00:00Z"), launchDate: "2026-10-25" }, "Europe/London");
    expect(iso(autumn)).toBe("2026-10-26T00:00:00.000Z");
    // 29 March is 23 hours long: it ends at midnight BST.
    const spring = editableUntil({ launchedAt: at("2026-03-29T08:00:00Z"), launchDate: "2026-03-29" }, "Europe/London");
    expect(iso(spring)).toBe("2026-03-29T23:00:00.000Z");
    // The Azores skip midnight on 29 March, so the 28th runs until 01:00 on the 29th.
    const azores = editableUntil(
      { launchedAt: at("2026-03-28T10:00:00Z"), launchDate: "2026-03-28" },
      "Atlantic/Azores",
    );
    expect(iso(azores)).toBe("2026-03-29T01:00:00.000Z");
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
  });
});
