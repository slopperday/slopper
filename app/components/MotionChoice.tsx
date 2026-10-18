import { useState } from "react";
import { useRouteLoaderData } from "react-router";
import { type MotionChoice as Choice, motionCookie } from "~/lib/motion";
import type { loader as rootLoader } from "~/root";

const CHOICES: readonly { value: Choice; label: string; hint: string }[] = [
  { value: null, label: "Like my device", hint: "Moves unless your device asks for less motion." },
  { value: "full", label: "Animate", hint: "Charts and tiles move, whatever your device says." },
  { value: "reduce", label: "Keep still", hint: "Nothing slides, grows or flips." },
];

/**
 * Whether Slopper animates, in this browser: a cookie, so it holds signed
 * in or out and the server renders pages already moving or still.
 */
export function MotionChoice() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const [choice, setChoice] = useState<Choice>(root?.motion ?? null);

  function choose(next: Choice) {
    document.cookie = motionCookie(next);
    if (next) document.documentElement.dataset.motion = next;
    else delete document.documentElement.dataset.motion;
    setChoice(next);
  }

  return (
    <section id="motion" className="mt-16 scroll-mt-24" aria-labelledby="motion-title">
      <h2 id="motion-title" className="title-2">
        Motion
      </h2>
      <p className="mt-2 text-muted">Animations on charts, the race clock and the rest of the site.</p>
      <fieldset className="mt-6 grid gap-2">
        <legend className="sr-only">Motion</legend>
        {CHOICES.map((option) => (
          <label key={option.label} className="panel flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="motion"
              checked={choice === option.value}
              onChange={() => choose(option.value)}
              className="mt-1 size-5"
            />
            <span>
              <span className="font-bold">{option.label}</span>
              <span className="block text-[0.9375rem] text-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
