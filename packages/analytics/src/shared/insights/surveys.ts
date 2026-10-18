import { EVENTS } from "../events";
import type { SurveyQuery } from "./queries";
import type { EventRow } from "./rows";

/**
 * A survey's results from its events: how many saw it, answered and closed
 * it; the answers counted; the average of a rating, the Net Promoter Score
 * of a 0–10 question; and the latest words people wrote.
 */

export interface SurveyResult {
  kind: "survey";
  key: string;
  /** People it was shown to. */
  shown: number;
  /** People who answered (their latest answer counts). */
  answered: number;
  /** People who closed it without answering. */
  dismissed: number;
  /** Each answer and how many gave it. */
  answers: { value: string; count: number }[];
  /** Ratings and 0–10 answers: their mean; null for words and choices, or no answers. */
  average: number | null;
  /** 0–10 answers: % promoters (9–10) minus % detractors (0–6), from -100 to 100. */
  nps: number | null;
  /** The latest open answers (the question itself or the follow-up), newest first. */
  texts: { at: number; text: string; sessionId: string | null }[];
}

const TEXTS = 50;

export class SurveyAggregator {
  private readonly shown = new Set<string>();
  private readonly dismissed = new Set<string>();
  /** Each person's latest answer. */
  private readonly answers = new Map<string, { at: number; value: string | number | null }>();
  private readonly texts: SurveyResult["texts"] = [];

  constructor(private readonly query: SurveyQuery) {}

  add(event: EventRow): void {
    if (event.properties.survey !== this.query.key) return;
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    if (event.name === EVENTS.surveyShown) {
      this.shown.add(event.personId);
    } else if (event.name === EVENTS.surveyDismissed) {
      this.dismissed.add(event.personId);
    } else if (event.name === EVENTS.surveySent) {
      const { value, choice, text } = event.properties;
      const answer = typeof value === "number" ? value : typeof choice === "string" ? choice : null;
      const before = this.answers.get(event.personId);
      if (!before || event.timestamp >= before.at)
        this.answers.set(event.personId, { at: event.timestamp, value: answer });
      if (typeof text === "string" && text.trim()) {
        this.texts.push({ at: event.timestamp, text: text.trim(), sessionId: event.sessionId });
      }
    }
  }

  result(): SurveyResult {
    const counts = new Map<string, number>();
    const numbers: number[] = [];
    for (const { value } of this.answers.values()) {
      if (value === null) continue;
      counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      if (typeof value === "number") numbers.push(value);
    }
    const numeric = this.query.question === "rating" || this.query.question === "nps";
    const average =
      numeric && numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    const nps =
      this.query.question === "nps" && numbers.length > 0
        ? Math.round(
            ((numbers.filter((value) => value >= 9).length - numbers.filter((value) => value <= 6).length) /
              numbers.length) *
              100,
          )
        : null;
    const answered = new Set(this.answers.keys());
    return {
      kind: "survey",
      key: this.query.key,
      shown: new Set([...this.shown, ...answered, ...this.dismissed]).size,
      answered: answered.size,
      dismissed: [...this.dismissed].filter((person) => !answered.has(person)).length,
      answers: [...counts].map(([value, count]) => ({ value, count })),
      average,
      nps,
      texts: this.texts.sort((a, b) => b.at - a.at).slice(0, TEXTS),
    };
  }
}
