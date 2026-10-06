import { Link } from "react-router";
import type { Route } from "./+types/home";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { goalProgress, type Goal } from "~/lib/goal";
import { seo } from "~/lib/seo";
import { SlopCard, SlopGrid } from "~/components/SlopCard";
import { RaceList } from "~/components/RaceList";
import { Countdown } from "~/components/Countdown";
import { GoalGrid } from "~/components/GoalGrid";
import { Ticker } from "~/components/Ticker";
import { UpdatesList } from "~/components/UpdatesList";
import { StreakList } from "~/components/StreakList";
import { Splat } from "~/components/Splat";
import { EmptyState } from "~/components/Shared";
import { useLive } from "~/components/Live";

const DAY_MS = 86_400_000;

/** A week back, rounded to the hour so the live query's arguments stay stable. */
function weekAgo(): number {
  return Math.floor(Date.now() / 3_600_000) * 3_600_000 - 7 * DAY_MS;
}

export async function loader({ context }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext).user;
  const asUser = viewer?._id;
  const since = weekAgo();
  const [feed, champion, streaks, slopcessful, profile] = await Promise.all([
    convex.query(api.home.feed, { asUser, since }),
    convex.query(api.race.champion, { asUser }),
    convex.query(api.goals.standings, { limit: 6 }),
    convex.query(api.slops.slopcessful, { limit: 3, asUser }),
    viewer ? convex.query(api.users.profile, { username: viewer.username, asUser }) : Promise.resolve(null),
  ]);
  return { since, feed, champion, streaks, slopcessful, profile, username: viewer?.username ?? null };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { path: "/" });

export default function Home({ loaderData }: Route.ComponentProps) {
  const feed = useLive(api.home.feed, { since: loaderData.since }, loaderData.feed);
  const champion = useLive(api.race.champion, {}, loaderData.champion);
  const streaks = useLive(api.goals.standings, { limit: 6 }, loaderData.streaks);
  const slopcessful = useLive(api.slops.slopcessful, { limit: 3 }, loaderData.slopcessful);
  const profile = useLive(api.users.profile, { username: loaderData.username ?? "" }, loaderData.profile);
  const signedIn = loaderData.username !== null;
  return (
    <>
      {signedIn && profile ? (
        <ViewerStrip progress={profile.progress} username={profile.owner.username} streak={profile.streak} />
      ) : (
        <Hero />
      )}
      {feed.ticker.length > 0 && <Ticker items={feed.ticker} />}

      <section id="today" className="mx-auto grid max-w-6xl scroll-mt-24 gap-10 px-4 pt-14 lg:grid-cols-[1fr_22rem]">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Live · closes at midnight UTC</p>
              <h2 className="font-wide text-3xl font-black sm:text-4xl">Today's race</h2>
            </div>
            <div className="flex items-center gap-2">
              <Countdown utc compact />
              <Link to="/today" className="btn btn-sm">
                Full race →
              </Link>
            </div>
          </div>
          <div className="mt-8">
            {feed.race.length > 0 ? (
              <RaceList items={feed.race} winnerId={null} />
            ) : (
              <EmptyState>
                <p className="font-display text-4xl text-slop-deep">Blank wall.</p>
                <p className="mx-auto mt-3 max-w-md">
                  Nothing launched today yet. The first slop has the race to itself.
                </p>
                <Link to={signedIn ? "/new" : "/login"} className="btn btn-slop mt-6">
                  Throw the first slop
                </Link>
              </EmptyState>
            )}
          </div>
        </div>
        <aside>
          <p className="eyebrow">Latest winner</p>
          <h2 className="font-wide text-2xl font-black">🏆 Slop of the day</h2>
          <div className="mt-8">
            {champion ? (
              <>
                <SlopCard item={champion.item} />
                <Link
                  to={`/day/${champion.date}`}
                  className="mt-4 inline-block font-mono text-xs tracking-wider uppercase hover:underline"
                >
                  See {champion.date}'s race →
                </Link>
              </>
            ) : (
              <p className="rounded-2xl border-2 border-dashed border-ink/40 p-6 text-sm text-muted">
                No winner yet. The top slop at midnight UTC takes it.
              </p>
            )}
          </div>
        </aside>
      </section>

      {feed.wall.length > 0 && (
        <section className="mx-auto mt-20 max-w-6xl px-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">This week</p>
              <h2 className="font-wide text-3xl font-black">Still sticking</h2>
            </div>
            <Link to="/wall" className="btn btn-sm">
              The whole wall →
            </Link>
          </div>
          <div className="mt-10">
            <SlopGrid items={feed.wall} />
          </div>
        </section>
      )}

      {slopcessful.length > 0 && (
        <section className="mx-auto mt-20 max-w-6xl px-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">They kept slopping</p>
              <h2 className="font-wide text-3xl font-black">
                <span className="text-gold drop-shadow-[2px_2px_0_var(--shadow)]">★</span> Slopcessful
              </h2>
            </div>
            <Link to="/slopcessful" className="btn btn-sm">
              All of them →
            </Link>
          </div>
          <div className="mt-10">
            <SlopGrid items={slopcessful} />
          </div>
        </section>
      )}

      <section className="mx-auto mt-20 grid max-w-6xl gap-10 px-4 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <p className="eyebrow">Fixes, features, re-promotes</p>
          <h2 className="font-wide text-2xl font-black">Updates</h2>
          <UpdatesList entries={feed.updates} />
        </div>
        <div>
          <p className="eyebrow">Open goals</p>
          <h2 className="font-wide text-2xl font-black">Streaks</h2>
          <StreakList rows={streaks} />
        </div>
      </section>

      {!signedIn && <HowItWorks />}
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b-2 border-ink">
      <Splat seed={7} className="pointer-events-none absolute -top-24 -right-24 size-[28rem] text-slop/25" />
      <Splat seed={42} className="pointer-events-none absolute bottom-[-6rem] left-[-5rem] size-72 text-slop/15" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:py-20 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="eyebrow">slopper.day</p>
          <h1 className="font-wide mt-4 text-[clamp(2.6rem,7.5vw,5.4rem)] leading-[0.9] font-black tracking-tight">
            Throw{" "}
            <span className="relative isolate inline-block px-1 font-display font-normal tracking-normal text-slop-ink">
              <Splat seed={3} stretch className="absolute -inset-x-4 -top-3 -bottom-1 -z-10 text-slop" />
              slop
            </span>{" "}
            at the wall.
            <br />
            Every day.
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted">
            Everyone says slop is bad. Everything good started as slop, and now you can make it at scale. Set a goal,
            ship something every day, and <strong className="text-ink">keep slopping until one is slopcessful</strong>.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login?returnTo=%2Fgoal" className="btn btn-slop">
              Start slopping
            </Link>
            <a href="#today" className="btn">
              See today's race
            </a>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-md rotate-[1.5deg]">
          <GoalGrid progress={SAMPLE_PROGRESS} username="you" streak={6} demo />
        </div>
      </div>
    </section>
  );
}

const SAMPLE_START = "2026-01-01";
const SAMPLE_GOAL: Goal = {
  title: "30 slops in 30 days",
  target: 30,
  days: 30,
  startDate: SAMPLE_START,
  abandonedAt: null,
};
const SAMPLE_PROGRESS = goalProgress(
  SAMPLE_GOAL,
  [1, 2, 3, 4, 6, 7, 7, 8, 9, 10, 11].map((day) => ({
    id: `d${day}`,
    name: `Slop ${day}`,
    slug: "sample",
    launchDate: `2026-01-${String(day).padStart(2, "0")}`,
  })),
  "2026-01-12",
);

function ViewerStrip({
  progress,
  username,
  streak,
}: {
  progress: ReturnType<typeof goalProgress> | null;
  username: string;
  streak: number;
}) {
  return (
    <section className="border-b-2 border-ink bg-wall-deep">
      <div className="mx-auto max-w-6xl px-4 py-10">
        {progress ? (
          <GoalGrid progress={progress} username={username} streak={streak} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border-2 border-dashed border-ink p-6 sm:p-8">
            <div>
              <p className="eyebrow">No goal yet</p>
              <h1 className="font-wide mt-1 text-2xl font-black sm:text-3xl">How many slops, how many days?</h1>
              <p className="mt-2 max-w-lg text-muted">
                Pick a number and a deadline. Every day you ship leaves a splat.{" "}
                {streak > 0 ? `You're on a ${streak} day streak already.` : ""}
              </p>
            </div>
            <Link to="/goal" className="btn btn-slop">
              Set a goal
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "Set a goal",
      body: "30 slops in 30 days. 7 in 7. 100 in 100. The day ends at midnight where you are.",
    },
    {
      title: "Ship daily",
      body: "A website, a TestFlight link, an Android beta, a repo. Messy counts. Live is the only requirement.",
    },
    {
      title: "Auto-post",
      body: "Connect X (as many accounts as you like), LinkedIn and Bluesky. Launches and updates post themselves.",
    },
    {
      title: "Keep slopping",
      body: "Post updates, ship features, re-promote. When one breaks out, mark it slopcessful.",
    },
  ];
  return (
    <section className="mx-auto mt-24 max-w-6xl px-4">
      <p className="eyebrow">How it works</p>
      <h2 className="font-wide text-3xl font-black sm:text-4xl">Volume beats taste.</h2>
      <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.title} className="stuck p-5">
            <span className="font-wide text-4xl font-black text-slop-deep">{index + 1}</span>
            <h3 className="mt-2 text-lg font-black">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
