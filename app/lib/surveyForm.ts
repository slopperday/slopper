import type { SurveyDefinition, SurveyKind } from "@slopperday/analytics/shared/surveys";

/**
 * The survey form at /analytics/surveys, as plain fields: options one per
 * line, who it's for as a choice, the wait in seconds. Pure, so it's tested.
 */

export const SURVEY_KINDS: readonly { value: SurveyKind; label: string }[] = [
  { value: "rating", label: "A rating, 1 to 5" },
  { value: "nps", label: "How likely to recommend, 0 to 10" },
  { value: "choice", label: "One of a few options" },
  { value: "text", label: "Their own words" },
];

export interface SurveyFields extends SurveyDefinition {
  name: string;
}

function kindOf(value: string): SurveyKind {
  return SURVEY_KINDS.find((kind) => kind.value === value)?.value ?? "rating";
}

/** Reads the form's fields; `get` returns "" for a field that isn't there. */
export function parseSurveyForm(get: (name: string) => string): SurveyFields {
  const kind = kindOf(get("kind"));
  const audience = get("audience");
  const delay = Number(get("delaySeconds"));
  return {
    key: get("key").trim().toLowerCase(),
    name: get("name").trim(),
    question: get("question").trim(),
    kind,
    choices:
      kind === "choice"
        ? get("choices")
            .split("\n")
            .map((choice) => choice.trim())
            .filter(Boolean)
        : [],
    followUp: get("followUp").trim() || null,
    target: {
      pathPrefix: get("pathPrefix").trim() || "/",
      signedIn: audience === "signed-in" ? true : audience === "visitors" ? false : null,
      delaySeconds: Number.isFinite(delay) ? Math.round(delay) : -1,
    },
  };
}

/** A survey back as form fields, to change it. */
export function surveyFormValues(survey: SurveyFields): Record<string, string> {
  return {
    key: survey.key,
    name: survey.name,
    question: survey.question,
    kind: survey.kind,
    choices: survey.choices.join("\n"),
    followUp: survey.followUp ?? "",
    pathPrefix: survey.target.pathPrefix,
    audience: survey.target.signedIn === null ? "anyone" : survey.target.signedIn ? "signed-in" : "visitors",
    delaySeconds: String(survey.target.delaySeconds),
  };
}
