// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api } from "../src/component/_generated/api";
import schema from "../src/component/schema";
import { type EventRow, SurveyAggregator } from "../src/shared/insights";
import { type SurveyDefinition, surveyFor, surveyProblems, surveyScale } from "../src/shared/surveys";

/** Surveys: what's valid, who's asked which, how answers add up, and the component that keeps them. */

const modules = import.meta.glob("../src/component/**/*.ts");

const RATING: SurveyDefinition = {
  key: "wall-rating",
  question: "How easy was it to find something you liked?",
  kind: "rating",
  choices: [],
  followUp: "What would make it easier?",
  target: { pathPrefix: "/wall", signedIn: null, delaySeconds: 5 },
};

describe("survey rules", () => {
  it("accepts a sound survey and says what's wrong with others", () => {
    expect(surveyProblems(RATING)).toEqual([]);
    expect(surveyProblems({ ...RATING, key: "Bad Key", question: " " })).toEqual([
      "A key is lowercase letters, digits and dashes, starting with a letter.",
      "Ask a question.",
    ]);
    expect(surveyProblems({ ...RATING, kind: "choice", choices: ["Only one"] })).toContain(
      "A choice needs two options at least.",
    );
    expect(surveyProblems({ ...RATING, kind: "choice", choices: ["Same", "Same"] })).toContain(
      "Each option needs its own words.",
    );
    expect(surveyProblems({ ...RATING, choices: ["stray"] })).toContain("Only a choice has options.");
    expect(surveyProblems({ ...RATING, target: { ...RATING.target, pathPrefix: "wall", delaySeconds: -1 } })).toEqual([
      "Pages start with /.",
      "Wait 0 to 600 seconds before showing it.",
    ]);
  });

  it("asks the first matching survey this browser hasn't answered or closed", () => {
    const visitorsOnly: SurveyDefinition = {
      ...RATING,
      key: "visitors",
      target: { pathPrefix: "/", signedIn: false, delaySeconds: 0 },
    };
    const surveys = [RATING, visitorsOnly];
    expect(surveyFor(surveys, { path: "/wall", signedIn: true }, new Set())?.key).toBe("wall-rating");
    expect(surveyFor(surveys, { path: "/wall", signedIn: true }, new Set(["wall-rating"]))).toBeNull();
    expect(surveyFor(surveys, { path: "/wall", signedIn: false }, new Set(["wall-rating"]))?.key).toBe("visitors");
    expect(surveyFor(surveys, { path: "/today", signedIn: true }, new Set())).toBeNull();
    expect(surveyScale("nps")).toHaveLength(11);
    expect(surveyScale("text")).toEqual([]);
  });
});

describe("SurveyAggregator", () => {
  const range = { from: 0, to: 10_000 };
  const event = (name: string, personId: string, properties: EventRow["properties"], timestamp = 1_000): EventRow => ({
    name,
    personId,
    sessionId: `s-${personId}`,
    timestamp,
    path: "/wall",
    properties: { survey: "nps", ...properties },
  });

  it("counts each person's latest answer, the NPS and what they wrote", () => {
    const survey = new SurveyAggregator({ kind: "survey", range, key: "nps", question: "nps" });
    for (const person of ["a", "b", "c", "d", "e"]) survey.add(event("$surveyShown", person, {}));
    survey.add(event("$surveySent", "a", { value: 10, text: "Love the wall" }));
    survey.add(event("$surveySent", "b", { value: 9 }));
    survey.add(event("$surveySent", "c", { value: 3 }, 1_000));
    survey.add(event("$surveySent", "c", { value: 7 }, 2_000));
    survey.add(event("$surveyDismissed", "d", {}));
    survey.add(event("$surveySent", "z", { value: 0 }, 20_000));
    survey.add(event("$surveySent", "y", { value: 0, survey: "other" }));
    const result = survey.result();
    // 10 and 9 promote, 7 is passive: (2 - 0) / 3.
    expect(result).toMatchObject({ shown: 5, answered: 3, dismissed: 1, nps: 67 });
    expect(result.average).toBeCloseTo(26 / 3);
    expect(result.answers).toEqual(
      expect.arrayContaining([
        { value: "10", count: 1 },
        { value: "9", count: 1 },
        { value: "7", count: 1 },
      ]),
    );
    expect(result.texts).toEqual([{ at: 1_000, text: "Love the wall", sessionId: "s-a" }]);
  });

  it("counts choices without an average", () => {
    const survey = new SurveyAggregator({ kind: "survey", range, key: "nps", question: "choice" });
    survey.add(event("$surveySent", "a", { choice: "Games" }));
    survey.add(event("$surveySent", "b", { choice: "Games" }));
    expect(survey.result()).toMatchObject({ answers: [{ value: "Games", count: 2 }], average: null, nps: null });
  });
});

describe("the surveys component", () => {
  it("keeps drafts changeable, serves running ones, and keeps stopped ones' place", async () => {
    const t = convexTest(schema, modules);
    const { key, question, kind, choices, followUp, target } = RATING;
    const fields = { key, name: "Wall rating", question, kind, choices, followUp, target };
    expect(await t.mutation(api.surveys.save, fields)).toEqual({ created: true });
    expect(await t.mutation(api.surveys.save, { ...fields, question: "Changed?" })).toEqual({ created: false });
    expect(await t.query(api.surveys.definitions, {})).toEqual([]);
    await expect(t.mutation(api.surveys.save, { ...fields, key: "Nope" })).rejects.toThrow("A key is lowercase");

    await t.mutation(api.surveys.start, { key });
    expect(await t.query(api.surveys.definitions, {})).toEqual([
      { key, question: "Changed?", kind, choices, followUp, target },
    ]);
    await expect(t.mutation(api.surveys.save, fields)).rejects.toThrow("It has started");
    await expect(t.mutation(api.surveys.start, { key })).rejects.toThrow("already started");

    await t.mutation(api.surveys.stop, { key });
    expect(await t.query(api.surveys.definitions, {})).toEqual([]);
    expect((await t.query(api.surveys.get, { key }))?.status).toBe("stopped");
    expect(await t.mutation(api.surveys.remove, { key })).toBe(true);
    expect(await t.mutation(api.surveys.remove, { key })).toBe(false);
  });

  it("keeps only a choice's options, trimmed", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.surveys.save, {
      key: "pick",
      name: "",
      question: "What brought you here?",
      kind: "choice",
      choices: [" A friend ", "", "Search"],
      followUp: "  ",
      target: { pathPrefix: "/", signedIn: null, delaySeconds: 0 },
    });
    expect(await t.query(api.surveys.get, { key: "pick" })).toMatchObject({
      name: "pick",
      choices: ["A friend", "Search"],
      followUp: null,
    });
  });
});
