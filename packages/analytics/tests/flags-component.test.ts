// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api } from "../src/component/_generated/api";
import schema from "../src/component/schema";

/** Flags and experiments as the component stores them. */

const modules = import.meta.glob("../src/component/**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

const ON_OFF = {
  key: "new-wall",
  name: "The new wall",
  description: "",
  active: true,
  variants: null,
  conditions: [{ filters: [], rollout: 100, variant: null }],
  payloads: {},
};

const SPLIT = {
  ...ON_OFF,
  key: "wall-order",
  name: "Wall order",
  active: false,
  variants: [
    { key: "control", weight: 1 },
    { key: "newest", weight: 1 },
  ],
};

const EXPERIMENT = {
  key: "newest-first",
  name: "Newest first",
  hypothesis: "More upvotes.",
  flagKey: "wall-order",
  goal: { event: "slop upvoted", filters: [] },
};

describe("flags", () => {
  it("saves a flag, says whether it was new, and changes it in place", async () => {
    const t = setup();
    expect(await t.mutation(api.flags.save, ON_OFF)).toEqual({ created: true });
    expect(await t.mutation(api.flags.save, { ...ON_OFF, name: "Renamed" })).toEqual({ created: false });
    const flags = await t.query(api.flags.list, {});
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ key: "new-wall", name: "Renamed" });
  });

  it("refuses a flag with problems, and says what they are", async () => {
    const t = setup();
    await expect(t.mutation(api.flags.save, { ...ON_OFF, key: "Not A Key" })).rejects.toThrow(
      "A key is lowercase letters",
    );
    await expect(t.mutation(api.flags.save, { ...SPLIT, payloads: { control: "{nope" } })).rejects.toThrow(
      "The payload for “control” isn't JSON.",
    );
    expect(await t.query(api.flags.list, {})).toEqual([]);
  });

  it("hands out only active flags' definitions, without names or times", async () => {
    const t = setup();
    await t.mutation(api.flags.save, ON_OFF);
    await t.mutation(api.flags.save, SPLIT);
    expect(await t.query(api.flags.definitions, {})).toEqual([
      { key: "new-wall", active: true, variants: null, conditions: ON_OFF.conditions, payloads: {} },
    ]);
    expect(await t.mutation(api.flags.setActive, { key: "wall-order", active: true })).toBe(true);
    expect((await t.query(api.flags.definitions, {})).map((flag) => flag.key).sort()).toEqual([
      "new-wall",
      "wall-order",
    ]);
    expect(await t.mutation(api.flags.setActive, { key: "missing", active: true })).toBe(false);
  });

  it("won't delete a flag an experiment uses", async () => {
    const t = setup();
    await t.mutation(api.flags.save, SPLIT);
    await t.mutation(api.experiments.save, EXPERIMENT);
    await expect(t.mutation(api.flags.remove, { key: "wall-order" })).rejects.toThrow(
      "The experiment “Newest first” uses this flag: delete it first.",
    );
    expect(await t.mutation(api.experiments.remove, { key: "newest-first" })).toBe(true);
    expect(await t.mutation(api.flags.remove, { key: "wall-order" })).toBe(true);
    expect(await t.mutation(api.flags.remove, { key: "wall-order" })).toBe(false);
  });
});

describe("experiments", () => {
  it("needs a flag with variants, and a goal", async () => {
    const t = setup();
    await t.mutation(api.flags.save, ON_OFF);
    await expect(t.mutation(api.experiments.save, { ...EXPERIMENT, flagKey: "new-wall" })).rejects.toThrow(
      "two variants at least",
    );
    await expect(t.mutation(api.experiments.save, { ...EXPERIMENT, flagKey: "missing" })).rejects.toThrow(
      "two variants at least",
    );
    await t.mutation(api.flags.save, SPLIT);
    await expect(
      t.mutation(api.experiments.save, { ...EXPERIMENT, goal: { event: " ", filters: [] } }),
    ).rejects.toThrow("Say which event counts as the goal.");
  });

  it("starts by turning its flag on, and can't change once it has", async () => {
    const t = setup();
    await t.mutation(api.flags.save, SPLIT);
    expect(await t.mutation(api.experiments.save, EXPERIMENT)).toEqual({ created: true });
    expect(await t.mutation(api.experiments.save, { ...EXPERIMENT, hypothesis: "Changed." })).toEqual({
      created: false,
    });
    expect(await t.query(api.experiments.get, { key: "newest-first" })).toMatchObject({
      status: "draft",
      hypothesis: "Changed.",
      startedAt: null,
    });

    await t.mutation(api.experiments.start, { key: "newest-first" });
    expect(await t.query(api.experiments.get, { key: "newest-first" })).toMatchObject({ status: "running" });
    expect((await t.query(api.flags.get, { key: "wall-order" }))?.active).toBe(true);
    await expect(t.mutation(api.experiments.start, { key: "newest-first" })).rejects.toThrow("already started");
    await expect(t.mutation(api.experiments.save, EXPERIMENT)).rejects.toThrow("It has started");

    await t.mutation(api.experiments.stop, { key: "newest-first" });
    const stopped = await t.query(api.experiments.get, { key: "newest-first" });
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.endedAt).toBeGreaterThanOrEqual(stopped?.startedAt ?? Infinity);
    // Stopping leaves the flag as it is, for whoever ships the winner.
    expect((await t.query(api.flags.get, { key: "wall-order" }))?.active).toBe(true);
    await expect(t.mutation(api.experiments.stop, { key: "newest-first" })).rejects.toThrow("It isn't running.");
  });
});
