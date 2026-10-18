import { describe, expect, it } from "vite-plus/test";
import { evaluateFlag, evaluateFlags, type FlagDefinition, flagProblems, flagState } from "../src/shared/flags";
import { bucketOf } from "../src/shared/hash";
import { compareVariants, ExperimentAggregator, MINIMUM_EXPOSURE, seededRandom } from "../src/shared/insights";
import type { EventRow } from "../src/shared/insights";

function flag(overrides: Partial<FlagDefinition> = {}): FlagDefinition {
  return {
    key: "new-wall",
    active: true,
    variants: null,
    conditions: [{ filters: [], rollout: 100, variant: null }],
    payloads: {},
    ...overrides,
  };
}

const people = Array.from({ length: 4_000 }, (_, index) => `person-${index}`);

describe("bucketOf", () => {
  it("gives the same string the same bucket, spread evenly over [0, 1)", () => {
    expect(bucketOf("a")).toBe(bucketOf("a"));
    expect(bucketOf("a")).not.toBe(bucketOf("b"));
    const buckets = people.map((person) => bucketOf(person));
    expect(Math.min(...buckets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...buckets)).toBeLessThan(1);
    const low = buckets.filter((bucket) => bucket < 0.5).length / buckets.length;
    expect(low).toBeGreaterThan(0.47);
    expect(low).toBeLessThan(0.53);
  });
});

describe("evaluateFlag", () => {
  it("is off when inactive, whatever the conditions", () => {
    expect(evaluateFlag(flag({ active: false }), "anyone", {})).toBe(false);
  });

  it("rolls out to about the share asked for, and keeps people in as it grows", () => {
    const quarter = flag({ conditions: [{ filters: [], rollout: 25, variant: null }] });
    const half = flag({ conditions: [{ filters: [], rollout: 50, variant: null }] });
    const inQuarter = people.filter((person) => evaluateFlag(quarter, person, {}) === true);
    const inHalf = new Set(people.filter((person) => evaluateFlag(half, person, {}) === true));
    expect(inQuarter.length / people.length).toBeGreaterThan(0.22);
    expect(inQuarter.length / people.length).toBeLessThan(0.28);
    expect(inQuarter.every((person) => inHalf.has(person))).toBe(true);
    expect(
      people.some((person) =>
        evaluateFlag(flag({ conditions: [{ filters: [], rollout: 0, variant: null }] }), person, {}),
      ),
    ).toBe(false);
  });

  it("gives two flags at the same rollout different people", () => {
    const one = flag({ key: "one", conditions: [{ filters: [], rollout: 50, variant: null }] });
    const two = flag({ key: "two", conditions: [{ filters: [], rollout: 50, variant: null }] });
    const both = people.filter((person) => evaluateFlag(one, person, {}) && evaluateFlag(two, person, {}));
    expect(both.length / people.length).toBeGreaterThan(0.2);
    expect(both.length / people.length).toBeLessThan(0.3);
  });

  it("targets by properties, the first matching condition deciding", () => {
    const staffOnly = flag({
      conditions: [
        { filters: [{ key: "staff", operator: "equals", value: true }], rollout: 100, variant: null },
        { filters: [{ key: "country", operator: "equals", value: "GB" }], rollout: 0, variant: null },
      ],
    });
    expect(evaluateFlag(staffOnly, "a", { staff: true })).toBe(true);
    expect(evaluateFlag(staffOnly, "a", { staff: false, country: "GB" })).toBe(false);
    expect(evaluateFlag(staffOnly, "a", {})).toBe(false);
    const veterans = flag({
      conditions: [
        { filters: [{ key: "accountDays", operator: "greaterThan", value: 30 }], rollout: 100, variant: null },
      ],
    });
    expect(evaluateFlag(veterans, "a", { accountDays: 31 })).toBe(true);
    expect(evaluateFlag(veterans, "a", { accountDays: 3 })).toBe(false);
  });

  it("splits people between variants by weight, and a condition can pin one", () => {
    const split = flag({
      variants: [
        { key: "control", weight: 1 },
        { key: "test", weight: 3 },
      ],
    });
    const values = people.map((person) => evaluateFlag(split, person, {}));
    const test = values.filter((value) => value === "test").length / values.length;
    expect(test).toBeGreaterThan(0.72);
    expect(test).toBeLessThan(0.78);
    expect(new Set(values)).toEqual(new Set(["control", "test"]));
    const pinned = flag({
      variants: split.variants,
      conditions: [
        { filters: [{ key: "staff", operator: "equals", value: true }], rollout: 100, variant: "test" },
        { filters: [], rollout: 100, variant: null },
      ],
    });
    expect(people.every((person) => evaluateFlag(pinned, person, { staff: true }) === "test")).toBe(true);
  });

  it("evaluates every flag at once", () => {
    expect(evaluateFlags([flag(), flag({ key: "off", active: false })], "a", {})).toEqual({
      "new-wall": true,
      off: false,
    });
  });
});

describe("flagState", () => {
  it("hands code each value's payload, parsed", () => {
    const flags = [
      flag({ payloads: { true: '{"columns":3}' } }),
      flag({
        key: "wall-order",
        variants: [
          { key: "control", weight: 1 },
          { key: "newest", weight: 1 },
        ],
        conditions: [{ filters: [], rollout: 100, variant: "newest" }],
        payloads: { newest: '"by time"' },
      }),
      flag({ key: "off-flag", active: false, payloads: { true: "1" } }),
    ];
    expect(flagState(flags, "person-1", {})).toEqual({
      values: { "new-wall": true, "wall-order": "newest", "off-flag": false },
      payloads: { "new-wall": { columns: 3 }, "wall-order": "by time" },
    });
  });
});

describe("flagProblems", () => {
  it("accepts a sound flag", () => {
    expect(flagProblems(flag({ payloads: { true: '{"color":"green"}' } }))).toEqual([]);
  });

  it("names what's wrong", () => {
    expect(
      flagProblems(
        flag({
          key: "Bad Key",
          conditions: [{ filters: [], rollout: 120, variant: "ghost" }],
          variants: [
            { key: "a", weight: 1 },
            { key: "a", weight: 0 },
          ],
          payloads: { a: "{not json" },
        }),
      ),
    ).toEqual([
      "A key is lowercase letters, digits and dashes, starting with a letter.",
      "A rollout is from 0 to 100 percent.",
      "Each variant needs its own key.",
      "Every variant needs a weight above 0.",
      "There's no variant called “ghost”.",
      "The payload for “a” isn't JSON.",
    ]);
    expect(flagProblems(flag({ conditions: [] }))).toEqual([
      "Say who gets it: add a condition, even one for everyone.",
    ]);
    expect(flagProblems(flag({ conditions: [{ filters: [], rollout: 100, variant: "x" }] }))).toEqual([
      "Only a flag with variants can pick one in a condition.",
    ]);
  });
});

describe("experiments", () => {
  const range = { from: 1_000, to: 100_000 };
  const seen = (personId: string, variant: string, timestamp = 2_000): EventRow => ({
    name: "$featureFlagCalled",
    personId,
    sessionId: "s",
    timestamp,
    path: "/",
    properties: { flag: "new-wall", variant },
  });
  const goal = (personId: string, timestamp: number): EventRow => ({
    name: "slop launched",
    personId,
    sessionId: null,
    timestamp,
    path: null,
    properties: {},
  });

  it("counts people once, for the first variant they saw, and goals only after it", () => {
    const experiment = new ExperimentAggregator({
      flag: "new-wall",
      variants: ["control", "test"],
      goal: { event: "slop launched" },
      range,
    });
    experiment.addExposure(seen("a", "control"));
    experiment.addExposure(seen("a", "test", 3_000));
    experiment.addExposure(seen("b", "test"));
    experiment.addExposure(seen("c", "test"));
    experiment.addExposure({ ...seen("d", "test"), properties: { flag: "another", variant: "test" } });
    experiment.addExposure(seen("e", "test", 500));
    experiment.addGoal(goal("a", 2_500));
    experiment.addGoal(goal("b", 1_500));
    experiment.addGoal(goal("c", 5_000));
    const { variants, winner } = experiment.result();
    expect(variants.map(({ key, exposed, converted }) => ({ key, exposed, converted }))).toEqual([
      { key: "control", exposed: 1, converted: 1 },
      { key: "test", exposed: 2, converted: 1 },
    ]);
    expect(winner).toBeNull();
  });

  it("calls a clear winner only with enough people", () => {
    const strong = compareVariants([
      { key: "control", exposed: 1_000, converted: 100 },
      { key: "test", exposed: 1_000, converted: 160 },
    ]);
    expect(strong[1]?.chanceToWin).toBeGreaterThan(0.99);
    expect(strong[1]?.interval[0]).toBeLessThan(0.16);
    expect(strong[1]?.interval[1]).toBeGreaterThan(0.16);
    const even = compareVariants([
      { key: "control", exposed: 1_000, converted: 100 },
      { key: "test", exposed: 1_000, converted: 100 },
    ]);
    expect(even[0]?.chanceToWin).toBeGreaterThan(0.4);
    expect(even[0]?.chanceToWin).toBeLessThan(0.6);

    const experiment = new ExperimentAggregator({
      flag: "new-wall",
      variants: ["control", "test"],
      goal: { event: "slop launched" },
      range,
    });
    for (let index = 0; index < MINIMUM_EXPOSURE; index += 1) {
      experiment.addExposure(seen(`c${index}`, "control"));
      experiment.addExposure(seen(`t${index}`, "test"));
      if (index < 60) experiment.addGoal(goal(`t${index}`, 3_000));
      if (index < 10) experiment.addGoal(goal(`c${index}`, 3_000));
    }
    expect(experiment.result().winner).toBe("test");
  });

  it("gives the same answer for the same counts", () => {
    const counts = [
      { key: "a", exposed: 50, converted: 5 },
      { key: "b", exposed: 50, converted: 7 },
    ];
    expect(compareVariants(counts, 7)).toEqual(compareVariants(counts, 7));
    const random = seededRandom(3);
    const draws = Array.from({ length: 1_000 }, () => random());
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...draws)).toBeLessThan(1);
  });
});
