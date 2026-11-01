import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import { HACKER_HOUSE, HACKER_HOUSE_MODES, hackerHouseActive, hackerHouseMode } from "~/lib/hackerHouse";

export function HackerHouse({
  now,
  shipped,
  mode,
  signedIn,
}: {
  now: number;
  shipped: number;
  mode: string | null;
  signedIn: boolean;
}) {
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  if (!hackerHouseActive(clock)) return null;
  const picked = hackerHouseMode(mode);
  return (
    <section
      id="hacker-house"
      aria-labelledby="hacker-house-title"
      className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-12"
    >
      <div className="panel p-6 sm:p-10">
        <p className="caps text-muted">
          November 1–12, 2026 · {Math.ceil((HACKER_HOUSE.end - clock) / 86_400_000)} days left
        </p>
        <h2 id="hacker-house-title" className="title-2 mt-3">
          Solana Hacker House
        </h2>
        <p className="mt-3 text-muted">
          Twelve days. Pick your pace and ship. Add the Solana Hacker House tag to each app you launch by November 12,
          23:59 UTC. New apps count; updates and relaunches don’t.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {HACKER_HOUSE_MODES.map((option) => (
            <Form method="post" action="/?index" key={option.id}>
              <button
                type="submit"
                name="mode"
                value={option.id}
                disabled={!signedIn}
                aria-pressed={mode === option.id}
                className={`btn h-full w-full flex-col items-start gap-2 p-5 ${mode === option.id ? "btn-slop" : ""}`}
              >
                <span className="font-bold">{option.label}</span>
                <span>{option.target} apps in 12 days</span>
              </button>
            </Form>
          ))}
        </div>
        {signedIn ? (
          <div data-no-replay className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-bold" role="status">
                {picked
                  ? `${shipped} / ${picked.target} apps shipped${shipped >= picked.target ? " · Challenge complete!" : ""}`
                  : "Pick a mode to set your target."}
              </p>
              {picked && (
                <progress
                  className="mt-2 w-full accent-slop"
                  aria-label={`${picked.label} challenge progress`}
                  value={Math.min(shipped, picked.target)}
                  max={picked.target}
                />
              )}
              <p className="mt-1 text-sm text-muted">
                Checked, visible launches count. Your mode is saved in this browser until the event ends.
              </p>
            </div>
            <Link to="/new?challenge=solana-hacker-house" className="btn btn-slop">
              Ship a hacker house app
            </Link>
          </div>
        ) : (
          <Link to="/login?returnTo=%2F%23hacker-house" className="btn btn-slop mt-6">
            Sign in to take the challenge
          </Link>
        )}
      </div>
    </section>
  );
}
