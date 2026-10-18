import { describe, expect, it } from "vite-plus/test";
import {
  cleanStack,
  describeError,
  errorFingerprint,
  exceptionProperties,
  normalizeMessage,
} from "../src/shared/errors";
import { ErrorsAggregator, type ErrorsQuery, type EventRow } from "../src/shared/insights";

/** Errors as events: what's kept of one, how they're grouped, and issues from events. */

describe("describing errors", () => {
  it("keeps an error's type, message and a short stack without query strings", () => {
    const error = new TypeError("x is undefined");
    error.stack = [
      "TypeError: x is undefined",
      "    at load (https://slopper.day/assets/root-abc.js?token=secret:1:20)",
      ...Array.from({ length: 30 }, (_, index) => `    at frame${index} (https://slopper.day/a.js:1:${index})`),
    ].join("\n");
    const described = describeError(error);
    expect(described.type).toBe("TypeError");
    expect(described.message).toBe("x is undefined");
    expect(described.stack?.split("\n")).toHaveLength(20);
    expect(described.stack).toContain("root-abc.js:1:20");
    expect(described.stack).not.toContain("secret");
  });

  it("says what it can about things that aren't errors", () => {
    expect(describeError("plain words")).toEqual({ type: "Error", message: "plain words", stack: null });
    expect(describeError({ some: "object" }).message).toBe("Something that isn't an error was thrown (object).");
    expect(describeError(undefined).message).toBe("Something that isn't an error was thrown (undefined).");
    expect(cleanStack("a\nb?x=1")).toBe("a\nb");
  });

  it("groups the same error whatever its numbers, ids and values", () => {
    expect(normalizeMessage('Slop 42 "tilt maze" not found at https://slopper.day/x?y=1')).toBe(
      "Slop <n> <value> not found at <url>",
    );
    expect(normalizeMessage("Session 01a14edf-7376-72a2-b914-d9519a3efe66 expired")).toBe("Session <id> expired");
    expect(errorFingerprint("Error", "Slop 42 not found")).toBe(errorFingerprint("Error", "Slop 7 not found"));
    expect(errorFingerprint("Error", "Slop 42 not found")).not.toBe(errorFingerprint("TypeError", "Slop 42 not found"));
    expect(exceptionProperties(new RangeError("too far"), "reported")).toMatchObject({
      type: "RangeError",
      message: "too far",
      source: "reported",
      fingerprint: errorFingerprint("RangeError", "too far"),
    });
  });
});

describe("ErrorsAggregator", () => {
  const range = { from: 0, to: 10_000 };

  function exception(
    overrides: Partial<EventRow> & { message?: string; fingerprint?: string; source?: string },
  ): EventRow {
    const { message = "boom", fingerprint = "f1", source = "uncaught", ...row } = overrides;
    return {
      name: "$exception",
      personId: "p1",
      sessionId: "s1",
      timestamp: 1_000,
      path: "/wall",
      properties: { type: "Error", message, fingerprint, source, stack: `Error: ${message}` },
      ...row,
    };
  }

  it("groups errors into issues, most frequent first", () => {
    const errors = new ErrorsAggregator({ kind: "errors", range });
    errors.add(exception({ timestamp: 1_000 }));
    errors.add(exception({ timestamp: 3_000, personId: "p2", path: "/today", message: "boom again" }));
    errors.add(exception({ timestamp: 2_000, path: "/today" }));
    errors.add(exception({ fingerprint: "f2", message: "other", source: "server", path: null, sessionId: null }));
    errors.add(exception({ timestamp: 20_000 }));
    errors.add({ ...exception({}), name: "$pageview" });
    const result = errors.result();
    expect(result.total).toBe(4);
    expect(result.occurrences).toEqual([]);
    expect(result.issues.map((issue) => [issue.fingerprint, issue.count])).toEqual([
      ["f1", 3],
      ["f2", 1],
    ]);
    expect(result.issues[0]).toMatchObject({
      message: "boom again",
      people: 2,
      firstSeen: 1_000,
      lastSeen: 3_000,
      paths: [
        { path: "/today", count: 2 },
        { path: "/wall", count: 1 },
      ],
      sources: ["uncaught"],
    });
    expect(result.issues[1]?.paths).toEqual([{ path: "server", count: 1 }]);
  });

  it("lists one issue's latest occurrences when asked for it", () => {
    const query: ErrorsQuery = { kind: "errors", range, fingerprint: "f1" };
    const errors = new ErrorsAggregator(query);
    errors.add(exception({ timestamp: 1_000 }));
    errors.add(exception({ timestamp: 2_000, sessionId: "s2" }));
    errors.add(exception({ fingerprint: "f2" }));
    const result = errors.result();
    expect(result.issues.map((issue) => issue.fingerprint)).toEqual(["f1"]);
    expect(result.occurrences.map((occurrence) => occurrence.sessionId)).toEqual(["s2", "s1"]);
  });
});
