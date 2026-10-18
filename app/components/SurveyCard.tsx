import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router";
import { EVENTS } from "@slopperday/analytics/shared";
import { useAnalytics } from "@slopperday/analytics/react";
import { type SurveyDefinition, surveyFor, surveyScale } from "@slopperday/analytics/shared/surveys";

/**
 * Asks a running survey's question in a small card, once a matching page
 * has been open its few seconds. Answers go to analytics as events, so the
 * card waits for the SDK and never shows to anyone who turned analytics
 * off. Each browser is asked each survey once: answering or closing it
 * remembers it here.
 */

const DONE_KEY = "slopper_surveys_done";
/** How long the thank-you stays before the card goes. */
const THANKS_MS = 3_000;

function readDone(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    // Storage blocked (a private window) or garbled: everything is unanswered, and asking again is harmless.
    return new Set();
  }
}

function markDone(key: string): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...readDone(), key].slice(-100)));
  } catch {
    // Storage blocked: this page won't ask again anyway, and the next may.
  }
}

type Step =
  | { kind: "asking" }
  | { kind: "following"; answer: { value: number } | { choice: string } }
  | { kind: "thanks" };

export function SurveyCard({ surveys, signedIn }: { surveys: readonly SurveyDefinition[]; signedIn: boolean }) {
  const client = useAnalytics();
  const { pathname } = useLocation();
  const [survey, setSurvey] = useState<SurveyDefinition | null>(null);
  const [step, setStep] = useState<Step>({ kind: "asking" });
  const [text, setText] = useState("");
  const titleId = useId();

  useEffect(() => {
    if (!client || survey) return;
    const next = surveyFor(surveys, { path: pathname, signedIn }, readDone());
    if (!next) return;
    const timer = setTimeout(() => {
      setSurvey(next);
      setStep({ kind: "asking" });
      setText("");
      client.capture(EVENTS.surveyShown, { survey: next.key });
    }, next.target.delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [client, survey, surveys, pathname, signedIn]);

  useEffect(() => {
    if (step.kind !== "thanks") return;
    const timer = setTimeout(() => setSurvey(null), THANKS_MS);
    return () => clearTimeout(timer);
  }, [step]);

  if (!survey || !client) return null;

  function send(answer: { value: number } | { choice: string } | null, words: string) {
    if (!survey || !client) return;
    const trimmed = words.trim();
    client.capture(EVENTS.surveySent, {
      survey: survey.key,
      ...answer,
      ...(trimmed ? { text: trimmed } : {}),
    });
    markDone(survey.key);
    setStep({ kind: "thanks" });
  }

  function answer(given: { value: number } | { choice: string }) {
    if (survey?.followUp) setStep({ kind: "following", answer: given });
    else send(given, "");
  }

  function dismiss() {
    if (!survey || !client) return;
    client.capture(EVENTS.surveyDismissed, { survey: survey.key });
    markDone(survey.key);
    setSurvey(null);
  }

  const scale = surveyScale(survey.kind);
  return (
    <aside
      aria-labelledby={titleId}
      className="survey-card panel fixed right-4 bottom-4 z-40 grid w-[min(24rem,calc(100vw-2rem))] gap-4 shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <p id={titleId} className="font-bold">
          {step.kind === "thanks"
            ? "Thanks. That helps."
            : step.kind === "following"
              ? survey.followUp
              : survey.question}
        </p>
        {step.kind !== "thanks" && (
          <button
            type="button"
            onClick={dismiss}
            className="btn btn-sm btn-quiet -mt-1 -mr-2"
            aria-label="Close the survey"
          >
            ✕
          </button>
        )}
      </div>

      {step.kind === "asking" && scale.length > 0 && (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label={survey.question}>
            {scale.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => answer({ value })}
                className="btn btn-sm min-w-9 flex-1 bg-raised tabular-nums"
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>{survey.kind === "nps" ? "Not likely" : "Not at all"}</span>
            <span>{survey.kind === "nps" ? "Very likely" : "Very"}</span>
          </div>
        </div>
      )}

      {step.kind === "asking" && survey.kind === "choice" && (
        <div className="grid gap-2" role="group" aria-label={survey.question}>
          {survey.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => answer({ choice })}
              className="btn btn-sm bg-raised justify-start"
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      {(step.kind === "following" || (step.kind === "asking" && survey.kind === "text")) && (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(step.kind === "following" ? step.answer : null, text);
          }}
        >
          <label className="sr-only" htmlFor={`${titleId}-text`}>
            Your answer
          </label>
          <textarea
            id={`${titleId}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={1000}
            rows={3}
            className="input"
            // The question just appeared beside it: typing straight away is the point.
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-sm btn-slop" disabled={step.kind === "asking" && !text.trim()}>
              Send
            </button>
            {step.kind === "following" && (
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => send(step.answer, "")}>
                Skip
              </button>
            )}
          </div>
        </form>
      )}
    </aside>
  );
}
