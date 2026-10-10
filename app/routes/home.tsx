import { Link } from "react-router";
import type { Route } from "./+types/home";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { goalProgress, type Goal } from "~/lib/goal";
import { formatDay } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { RaceList, SlopFeature, SlopList } from "~/components/SlopList";
import { Countdown } from "~/components/Countdown";
import { GoalGrid } from "~/components/GoalGrid";
import { JustSlopped } from "~/components/JustSlopped";
import { UpdatesList } from "~/components/UpdatesList";
import { StreakList } from "~/components/StreakList";
import { EmptyState, useAutopostNetworks } from "~/components/Shared";
import { listWords } from "~/lib/display";
import { Icon } from "~/components/Icon";
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
      {feed.ticker.length > 0 && <JustSlopped items={feed.ticker} />}

      <section
        id="today"
        className="mx-auto grid max-w-6xl scroll-mt-24 gap-x-14 gap-y-20 px-4 pt-20 lg:grid-cols-[minmax(0,1fr)_21rem]"
      >
        {/* min-w-0: long names truncate instead of widening the page on phones. */}
        <div className="min-w-0">
          <SectionHead
            title="Today's race"
            line="Live, ranked by votes. Closes at midnight UTC."
            action={
              <>
                <Countdown className="text-[1.6rem]" />
                <Link to="/today" className="btn btn-sm">
                  Full race <Icon name="right" className="size-4" />
                </Link>
              </>
            }
          />
          <div className="mt-8">
            {feed.race.length > 0 ? (
              <RaceList items={feed.race} winnerId={null} />
            ) : (
              <EmptyState>
                <p className="font-display text-[2.75rem] leading-none font-black text-ink">Blank wall.</p>
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
        <aside className="min-w-0">
          <SectionHead
            title="Slop of the day"
            line={champion ? `Latest winner · ${formatDay(champion.date)}` : "Latest winner"}
          />
          <div className="mt-8">
            {champion ? (
              <>
                <SlopFeature item={champion.item} />
                <Link to={`/day/${champion.date}`} className="link mt-5 inline-flex min-h-11 items-center gap-1.5">
                  See {champion.date}'s race <Icon name="right" className="size-4" />
                </Link>
              </>
            ) : (
              <EmptyState>No winner yet. The top slop at midnight UTC takes it.</EmptyState>
            )}
          </div>
        </aside>
      </section>

      {feed.wall.length > 0 && (
        <section className="mx-auto mt-28 max-w-6xl px-4">
          <SectionHead
            title="Still sticking"
            line="This week's slops, still on the wall."
            action={
              <Link to="/wall" className="btn btn-sm">
                The whole wall <Icon name="right" className="size-4" />
              </Link>
            }
          />
          <div className="mt-10">
            <SlopList items={feed.wall} />
          </div>
        </section>
      )}

      {slopcessful.length > 0 && (
        <section className="mx-auto mt-28 max-w-6xl px-4">
          <SectionHead
            title="Slopcessful"
            line="They kept slopping until one broke out."
            action={
              <Link to="/slopcessful" className="btn btn-sm">
                All of them <Icon name="right" className="size-4" />
              </Link>
            }
          />
          <div className="mt-10">
            <SlopList items={slopcessful} />
          </div>
        </section>
      )}

      <section className="mx-auto mt-28 grid max-w-6xl gap-x-14 gap-y-20 px-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="min-w-0">
          <SectionHead title="Updates" line="Fixes, features, field tests and re-promotes." />
          <div className="mt-6">
            <UpdatesList entries={feed.updates} />
          </div>
        </div>
        <div className="min-w-0">
          <SectionHead title="Streaks" line="Everyone with a goal running." />
          <div className="mt-6">
            <StreakList rows={streaks} />
          </div>
        </div>
      </section>

      {!signedIn && <HowItWorks />}
    </>
  );
}

/** A section's title, one plain line under it, and an optional action on the right. */
function SectionHead({ title, line, action }: { title: string; line: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div>
        <h2 className="title-2">{title}</h2>
        <p className="mt-2 text-muted">{line}</p>
      </div>
      {action && <div className="flex items-center gap-3">{action}</div>}
    </div>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 pb-20 sm:pt-20 lg:pb-24">
      <h1 className="display max-w-[11ch] lg:max-w-none">
        Throw slop at the wall.
        <br />
        Every day.
      </h1>
      <div className="mt-7 grid items-start gap-8 sm:mt-10 sm:gap-12 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
        <div>
          <p className="lede sm:text-[1.25rem]">
            Everyone says slop is bad. Everything good started as slop, and now you can make it at scale. Set a goal,
            ship something every day, and <strong className="text-ink">keep slopping until one is slopcessful</strong>.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-9 sm:flex sm:flex-wrap">
            <Link to="/login?returnTo=%2Fgoal" className="btn btn-slop sm:btn-lg">
              Start slopping
            </Link>
            <a href="#today" className="btn sm:btn-lg">
              See today's race
            </a>
          </div>
        </div>
        <GoalGrid progress={SAMPLE_PROGRESS} username="you" streak={6} demo />
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
    <section className="mx-auto max-w-6xl px-4 pt-12 pb-16">
      {progress ? (
        <>
          <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div>
              <h1 className="title-1">Keep slopping.</h1>
              <p className="mt-3 text-muted">Ship something before your day runs out.</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <span className="lg:hidden">
                <Countdown className="text-[1.5rem]" />
              </span>
              <Link to="/new" className="btn btn-slop btn-lg">
                Throw today's slop
              </Link>
            </div>
          </div>
          <GoalGrid progress={progress} username={username} streak={streak} />
        </>
      ) : (
        <div className="panel flex flex-wrap items-center justify-between gap-6 p-6 sm:p-10">
          <div>
            <h1 className="title-1">How many days are you in for?</h1>
            <p className="lede mt-4">
              Commit to the days, then pick how hard you'll go. Every day you ship flips a tile.{" "}
              {streak > 0 ? `You're on a ${streak}-day streak already.` : ""}
            </p>
          </div>
          <Link to="/goal" className="btn btn-slop btn-lg">
            Set a goal
          </Link>
        </div>
      )}
    </section>
  );
}

function howItWorks(networks: readonly string[]) {
  const connect = networks.map((network) => (network === "X" ? "X (as many accounts as you like)" : network));
  return [
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
      body: `Connect ${listWords(connect, "and")}. Launches and updates post themselves.`,
    },
    {
      title: "Keep slopping",
      body: "Post updates, ship features, re-promote. When one breaks out, mark it slopcessful.",
    },
  ];
}

function HowItWorks() {
  const steps = howItWorks(useAutopostNetworks());
  return (
    <section className="mx-auto mt-32 max-w-6xl px-4">
      <h2 className="display max-w-[12ch] text-[clamp(3rem,7vw,5rem)]">Volume beats taste.</h2>
      <ol className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.title} className="border-t border-line-strong pt-5">
            <p className="font-display text-[1.75rem] leading-none font-extrabold">
              <span className="mr-2 text-faint tabular-nums">{index + 1}</span>
              {step.title}
            </p>
            <p className="mt-3 text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
