import { describe, expect, it } from "vite-plus/test";
import { parseSurveyForm, surveyFormValues } from "~/lib/surveyForm";

/** The admin survey form: what it reads and writes back. */

describe("the survey form", () => {
  const fields: Record<string, string> = {
    key: " Wall-Pick ",
    name: "What brought them",
    question: "What brought you to the wall?",
    kind: "choice",
    choices: "A friend\n\nSearch\n Hacker News \n",
    followUp: "",
    pathPrefix: "/wall",
    audience: "visitors",
    delaySeconds: "8",
  };
  const get = (name: string) => fields[name] ?? "";

  it("reads options one a line, the audience and the wait", () => {
    expect(parseSurveyForm(get)).toEqual({
      key: "wall-pick",
      name: "What brought them",
      question: "What brought you to the wall?",
      kind: "choice",
      choices: ["A friend", "Search", "Hacker News"],
      followUp: null,
      target: { pathPrefix: "/wall", signedIn: false, delaySeconds: 8 },
    });
  });

  it("gives a saved survey back as the same fields", () => {
    const survey = parseSurveyForm(get);
    expect(parseSurveyForm((name) => surveyFormValues(survey)[name] ?? "")).toEqual(survey);
  });

  it("falls back to a rating for anyone, and marks a wait that isn't a number", () => {
    const survey = parseSurveyForm((name) => ({ kind: "bogus", choices: "x", delaySeconds: "soon" })[name] ?? "");
    expect(survey).toMatchObject({
      kind: "rating",
      choices: [],
      target: { pathPrefix: "/", signedIn: null, delaySeconds: -1 },
    });
  });
});
