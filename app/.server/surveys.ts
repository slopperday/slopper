import { api } from "@convex/_generated/api";
import type { SurveyDefinition } from "@slopperday/analytics/shared/surveys";
import { convex } from "./convex";
import { remembered } from "./memory";

/**
 * Running surveys' questions, for pages to ask: kept in memory like flags'
 * definitions, so they cost a page nothing. The page picks one to show
 * (`surveyFor`), since only the browser knows what this person already answered.
 */

const definitions = remembered(() => convex.query(api.analytics.surveyDefinitions, {}));

export async function runningSurveys(now: number = Date.now()): Promise<SurveyDefinition[]> {
  return await definitions.get(now);
}

/** Forgets them, for an admin who just started or stopped one. */
export function forgetSurveys(): void {
  definitions.forget();
}
