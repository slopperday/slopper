import { type Infer, v } from "convex/values";
import { FLAG_KEY } from "./flags";

/**
 * Surveys: one question asked in the page, of the people a survey targets,
 * once each. Answers are events (`$surveySent`, with `$surveyShown` and
 * `$surveyDismissed` around them), so they sit in each person's history and
 * session, and results are worked out from events like any insight.
 */

export const surveyKindValidator = v.union(
  /** 1 to 5. */
  v.literal("rating"),
  /** 0 to 10: "how likely are you to recommend…". */
  v.literal("nps"),
  /** One of `choices`. */
  v.literal("choice"),
  /** Words. */
  v.literal("text"),
);

export type SurveyKind = Infer<typeof surveyKindValidator>;

export const surveyTargetValidator = v.object({
  /** Pages it may show on: paths starting with this ("/" for any). */
  pathPrefix: v.string(),
  /** Only people signed in, only people not, or anyone (null). */
  signedIn: v.union(v.boolean(), v.null()),
  /** Seconds on the page before it shows. */
  delaySeconds: v.number(),
});

export type SurveyTarget = Infer<typeof surveyTargetValidator>;

/** What a page needs to show a survey: its question, never its results. */
export const surveyDefinitionValidator = v.object({
  key: v.string(),
  question: v.string(),
  kind: surveyKindValidator,
  choices: v.array(v.string()),
  /** An optional second, open question after the first answer ("What would make it better?"). */
  followUp: v.union(v.string(), v.null()),
  target: surveyTargetValidator,
});

export type SurveyDefinition = Infer<typeof surveyDefinitionValidator>;

export const SURVEY_LIMITS = {
  questionLength: 200,
  choices: 6,
  choiceLength: 60,
  /** Characters an open answer keeps. */
  answerLength: 1_000,
  maxDelaySeconds: 600,
} as const;

/** The scale each kind answers on; empty for the kinds that aren't numbers. */
export function surveyScale(kind: SurveyKind): number[] {
  if (kind === "rating") return [1, 2, 3, 4, 5];
  if (kind === "nps") return Array.from({ length: 11 }, (_, value) => value);
  return [];
}

/** Problems with a survey before it's saved; empty when there are none. */
export function surveyProblems(survey: SurveyDefinition): string[] {
  const problems: string[] = [];
  if (!FLAG_KEY.test(survey.key))
    problems.push("A key is lowercase letters, digits and dashes, starting with a letter.");
  const question = survey.question.trim();
  if (!question) problems.push("Ask a question.");
  if (question.length > SURVEY_LIMITS.questionLength) {
    problems.push(`Keep the question under ${SURVEY_LIMITS.questionLength} characters.`);
  }
  if (survey.kind === "choice") {
    const choices = survey.choices.map((choice) => choice.trim()).filter(Boolean);
    if (choices.length < 2) problems.push("A choice needs two options at least.");
    if (choices.length > SURVEY_LIMITS.choices) problems.push(`Offer ${SURVEY_LIMITS.choices} options at most.`);
    if (new Set(choices).size !== choices.length) problems.push("Each option needs its own words.");
    if (choices.some((choice) => choice.length > SURVEY_LIMITS.choiceLength)) {
      problems.push(`Keep options under ${SURVEY_LIMITS.choiceLength} characters.`);
    }
  } else if (survey.choices.length > 0) {
    problems.push("Only a choice has options.");
  }
  if (!survey.target.pathPrefix.startsWith("/")) problems.push("Pages start with /.");
  const delay = survey.target.delaySeconds;
  if (!(Number.isInteger(delay) && delay >= 0 && delay <= SURVEY_LIMITS.maxDelaySeconds)) {
    problems.push(`Wait 0 to ${SURVEY_LIMITS.maxDelaySeconds} seconds before showing it.`);
  }
  return problems;
}

/**
 * The survey to show on a page, if any: the first running one whose pages
 * and audience match that this browser hasn't answered or closed.
 */
export function surveyFor(
  surveys: readonly SurveyDefinition[],
  page: { path: string; signedIn: boolean },
  done: ReadonlySet<string>,
): SurveyDefinition | null {
  return (
    surveys.find(
      (survey) =>
        !done.has(survey.key) &&
        page.path.startsWith(survey.target.pathPrefix) &&
        (survey.target.signedIn === null || survey.target.signedIn === page.signedIn),
    ) ?? null
  );
}
