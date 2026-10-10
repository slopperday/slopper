import { useState } from "react";
import { Form, Link } from "react-router";
import { addDays, formatDay } from "~/lib/dates";
import {
  DEFAULT_GOAL_DAYS,
  DEFAULT_GOAL_PACE,
  GOAL_DAY_CHOICES,
  GOAL_PACES,
  type GoalPace,
  paceTarget,
} from "~/lib/goal";
import { LIMITS } from "~/lib/model";
import { Field } from "./SlopFields";
import { Tiles } from "./Tiles";

/** A choice is picked: inverted, like every other picker on the site. Hover only tints the rest. */
const CHOICE =
  "rounded-2xl bg-sunk transition-colors peer-checked:bg-ink peer-checked:text-ground peer-not-checked:hover:bg-line peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--focus)";

/** A whole number in range, or null while the box is empty or wrong. */
function typedNumber(value: string, max: number): number | null {
  const number = Number(value);
  return value !== "" && Number.isInteger(number) && number >= 1 && number <= max ? number : null;
}

/**
 * Setting a goal on one screen, in the order people decide it: how many days
 * they're in for, then how hard they'll go in those days. The board at the
 * bottom spells the goal out on flip tiles as it changes. Every choice is a
 * plain form field, so the server works the goal out the same way without
 * JavaScript; typed numbers win over the buttons there too.
 */
export function GoalSetup({
  today,
  timeZone,
  errors,
}: {
  today: string;
  timeZone: string;
  errors: Record<string, string>;
}) {
  const [dayChoice, setDayChoice] = useState<number>(DEFAULT_GOAL_DAYS);
  const [customDays, setCustomDays] = useState("");
  const [pace, setPace] = useState<GoalPace>(DEFAULT_GOAL_PACE);
  const [exactTarget, setExactTarget] = useState("");
  const [startDate, setStartDate] = useState(today);

  const typedDays = typedNumber(customDays, LIMITS.goalDays);
  const days = typedDays ?? dayChoice;
  const typedTarget = typedNumber(exactTarget, 1000);
  const target = typedTarget ?? paceTarget(pace, days);
  const start = startDate >= today ? startDate : today;
  const blurb = typedTarget === null ? pace.blurb : `${target === 1 ? "One slop" : `${target} slops`}, your call.`;

  return (
    <Form method="post" className="mt-12 grid gap-14">
      <input type="hidden" name="intent" value="create" />

      <fieldset>
        <legend className="flex items-center gap-3">
          <Tiles value="1" className="text-[1.5rem]" />
          <span className="font-display text-[1.9rem] leading-none font-extrabold">How many days are you in for?</span>
        </legend>
        <div className="mt-5 flex flex-wrap gap-3">
          {GOAL_DAY_CHOICES.map((choice) => (
            <label key={choice} className="cursor-pointer">
              <input
                type="radio"
                name="days"
                value={choice}
                aria-label={`${choice} days`}
                checked={typedDays === null && dayChoice === choice}
                onChange={() => {
                  setDayChoice(choice);
                  setCustomDays("");
                }}
                className="peer sr-only"
              />
              <span className={`flex size-22 flex-col items-center justify-center ${CHOICE}`}>
                <span className="font-display text-[2.4rem] leading-none font-black tabular-nums">{choice}</span>
                <span className="mt-1 text-xs font-bold tracking-wide uppercase opacity-70">days</span>
              </span>
            </label>
          ))}
          <label
            className={`flex h-22 items-center gap-2 rounded-2xl px-4 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--focus) ${
              typedDays === null ? "bg-sunk hover:bg-line" : "bg-ink text-ground"
            }`}
          >
            <span className="text-sm font-bold opacity-70">Other</span>
            <input
              name="customDays"
              type="number"
              inputMode="numeric"
              min="1"
              max={LIMITS.goalDays}
              value={customDays}
              onChange={(event) => setCustomDays(event.target.value)}
              placeholder="45"
              aria-label="Other number of days"
              className="w-[3.2ch] bg-transparent font-display text-[2.4rem] leading-none font-black tabular-nums outline-none placeholder:opacity-35 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-xs font-bold tracking-wide uppercase opacity-70">days</span>
          </label>
        </div>
        {errors.days && (
          <p className="field-error" role="alert">
            {errors.days}
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend className="flex items-center gap-3">
          <Tiles value="2" className="text-[1.5rem]" />
          <span className="font-display text-[1.9rem] leading-none font-extrabold">
            How many slops in {days} {days === 1 ? "day" : "days"}?
          </span>
        </legend>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {GOAL_PACES.map((option) => (
            <label key={option.id} className="cursor-pointer">
              <input
                type="radio"
                name="pace"
                value={option.id}
                checked={typedTarget === null && pace.id === option.id}
                onChange={() => {
                  setPace(option);
                  setExactTarget("");
                }}
                className="peer sr-only"
              />
              <span className={`block h-full p-4 ${CHOICE}`}>
                <span className="block font-display text-[2.5rem] leading-none font-black tabular-nums">
                  {paceTarget(option, days)}
                  <span className="opacity-55">/{days}</span>
                </span>
                <span className="mt-2 block font-bold">{option.label}</span>
                <span className="block text-[0.9375rem] opacity-75">{option.blurb}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-muted">
          Or exactly
          <input
            name="target"
            type="number"
            inputMode="numeric"
            min="1"
            max="1000"
            value={exactTarget}
            onChange={(event) => setExactTarget(event.target.value)}
            placeholder={String(paceTarget(pace, days))}
            className="input w-24"
          />
          slops
        </label>
        {errors.target && (
          <p className="field-error" role="alert">
            {errors.target}
          </p>
        )}
      </fieldset>

      <div className="board flex flex-wrap items-end justify-between gap-x-8 gap-y-6 p-6 sm:p-8">
        <div className="min-w-0">
          <p className="caps text-board-muted">Your goal</p>
          <p
            className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 font-display text-[1.6rem] leading-none font-extrabold"
            aria-hidden="true"
          >
            <Tiles value={String(target)} className="text-[2.6rem]" />
            <span>{target === 1 ? "slop" : "slops"} in</span>
            <Tiles value={String(days)} className="text-[2.6rem]" />
            <span>{days === 1 ? "day" : "days"}</span>
          </p>
          <p className="sr-only" aria-live="polite">
            {target} slops in {days} days
          </p>
          <p className="mt-4 text-board-muted">
            {blurb} Starts {start === today ? "today" : formatDay(start)}, ends {formatDay(addDays(start, days - 1))}.
          </p>
        </div>
        <button type="submit" className="btn btn-slop btn-lg">
          Set the goal
        </button>
      </div>

      <details className="-mt-6" open={Boolean(errors.startDate || errors.title)}>
        <summary className="flex min-h-11 items-center text-muted underline hover:text-ink">
          Name it, or start another day
        </summary>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <Field id="title" label="Name" error={errors.title} hint={`Defaults to “${target} slops in ${days} days”.`}>
            <input id="title" name="title" className="input" maxLength={80} placeholder="Slopvember" />
          </Field>
          <Field id="startDate" label="Start" error={errors.startDate}>
            <input
              id="startDate"
              name="startDate"
              type="date"
              className="input"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              min={today}
              max={addDays(today, 30)}
            />
          </Field>
        </div>
        <p className="mt-6 text-muted">
          Days end at midnight in your time zone (<strong className="text-ink">{timeZone}</strong>,{" "}
          <Link to="/settings" className="link">
            change
          </Link>
          ).
        </p>
      </details>
    </Form>
  );
}
