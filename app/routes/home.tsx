import { Link } from "react-router";
import type { Route } from "./+types/home";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import { getSlops, listSlopcessful, listSlopsSince, listUserSlops } from "~/.server/db/slops";
import { listRecentUpdates } from "~/.server/db/activity";
import { dayRace, latestSlopOfTheDay, utcDate } from "~/.server/db/daily";
import { getOpenGoal } from "~/.server/db/goals";
import { getUsersById, isVisibleTo, toFeedItems } from "~/.server/feed";
import { slopperCard, standings } from "~/.server/leaderboard";
import { memo } from "~/.server/memo";
import { rankHot } from "~/lib/ranking";
import { localDate } from "~/lib/dates";
import { goalProgress } from "~/lib/goal";
import { publicUser, type Goal } from "~/lib/model";
import { seo } from "~/lib/seo";
import { SlopCard, SlopGrid } from "~/components/SlopCard";
import { RaceList } from "~/components/RaceList";
import { Countdown } from "~/components/Countdown";
import { GoalGrid } from "~/components/GoalGrid";
import { Ticker } from "~/components/Ticker";
import { type UpdateEntry, UpdatesList } from "~/components/UpdatesList";
import { StreakList } from "~/components/StreakList";
import { Splat } from "~/components/Splat";
import { EmptyState } from "~/components/Shared";

const DAY_MS = 86_400_000;

export async function loader({ context }: Route.LoaderArgs) {
  const kv = await getKv();
  const viewer = context.get(viewerContext).user;
  const now = new Date();

  const today = utcDate(now);
  const [week, race, champion, recentUpdates, cards, slopcessful] = await Promise.all([
    memo("home:week", 15_000, () => listSlopsSince(kv, new Date(now.getTime() - 7 * DAY_MS))),
    memo(`race:${today}`, 15_000, () => dayRace(kv, today, now)),
    memo("home:champion", 60_000, () => latestSlopOfTheDay(kv, now)),
    memo("home:updates", 15_000, () => listRecentUpdates(kv, 30)),
    memo("home:standings", 30_000, () => standings(kv, now)),
    memo("home:slopcessful", 30_000, () => listSlopcessful(kv)),
  ]);

  const raceItems = await toFeedItems(kv, race.ranking.slice(0, 10), viewer);
  // An empty race still leaves something to look at: the week's best.
  const wall = raceItems.length > 0 ? [] : await toFeedItems(kv, rankHot(week, now).slice(0, 6), viewer);
  const ticker = await toFeedItems(kv, week.slice(0, 14), viewer);
  const [championItem] = champion ? await toFeedItems(kv, [champion.slop], viewer) : [];

  const logUpdates = recentUpdates.filter((update) => update.kind !== "launch").slice(0, 8);
  const logSlops = new Map(
    (
      await getSlops(
        kv,
        logUpdates.map((update) => update.slopId),
      )
    ).map((slop) => [slop.id, slop]),
  );
  const logOwners = await getUsersById(
    kv,
    logUpdates.map((update) => update.userId),
  );
  const updates: UpdateEntry[] = [];
  for (const update of logUpdates) {
    const slop = logSlops.get(update.slopId);
    const owner = logOwners.get(update.userId);
    if (slop && owner && isVisibleTo(slop, null)) {
      updates.push({
        update: { id: update.id, kind: update.kind, body: update.body, createdAt: update.createdAt },
        slop: { name: slop.name, slug: slop.slug },
        owner: publicUser(owner),
      });
    }
  }

  let viewerCard = null;
  if (viewer) {
    const goal = await getOpenGoal(kv, viewer.id, localDate(now, viewer.timeZone));
    viewerCard = slopperCard(viewer, await listUserSlops(kv, viewer.id), goal, now);
  }

  return {
    race: raceItems,
    wall,
    champion: championItem ? { date: champion!.date, item: championItem } : null,
    ticker,
    updates,
    streaks: cards.slice(0, 6),
    slopcessful: await toFeedItems(kv, slopcessful.slice(0, 3), viewer),
    viewerCard,
  };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { path: "/" });

export default function Home({ loaderData }: Route.ComponentProps) {
  const { viewerCard } = loaderData;
  return (
    <>
      {viewerCard ? <ViewerStrip card={viewerCard} /> : <Hero />}
      {loaderData.ticker.length > 0 && <Ticker items={loaderData.ticker} />}

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
            {loaderData.race.length > 0 ? (
              <RaceList items={loaderData.race} winnerId={null} />
            ) : (
              <EmptyState>
                <p className="font-display text-4xl text-slop-deep">Blank wall.</p>
                <p className="mx-auto mt-3 max-w-md">
                  Nothing launched today yet. The first slop has the race to itself.
                </p>
                <Link to={viewerCard ? "/new" : "/login"} className="btn btn-slop mt-6">
                  Throw the first slop
                </Link>
              </EmptyState>
            )}
          </div>
        </div>
        <aside>
          <p className="eyebrow">Yesterday's winner</p>
          <h2 className="font-wide text-2xl font-black">🏆 Slop of the day</h2>
          <div className="mt-8">
            {loaderData.champion ? (
              <>
                <SlopCard item={loaderData.champion.item} />
                <Link
                  to={`/day/${loaderData.champion.date}`}
                  className="mt-4 inline-block font-mono text-xs tracking-wider uppercase hover:underline"
                >
                  See {loaderData.champion.date}'s race →
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

      {loaderData.wall.length > 0 && (
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
            <SlopGrid items={loaderData.wall} />
          </div>
        </section>
      )}

      {loaderData.slopcessful.length > 0 && (
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
            <SlopGrid items={loaderData.slopcessful} />
          </div>
        </section>
      )}

      <section className="mx-auto mt-20 grid max-w-6xl gap-10 px-4 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <p className="eyebrow">Fixes, features, re-promotes</p>
          <h2 className="font-wide text-2xl font-black">Updates</h2>
          <UpdatesList entries={loaderData.updates} />
        </div>
        <div>
          <p className="eyebrow">Open goals</p>
          <h2 className="font-wide text-2xl font-black">Streaks</h2>
          <StreakList rows={loaderData.streaks} />
        </div>
      </section>

      {!viewerCard && <HowItWorks />}
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
  id: "sample",
  userId: "sample",
  title: "30 slops in 30 days",
  target: 30,
  days: 30,
  startDate: SAMPLE_START,
  abandonedAt: null,
  createdAt: SAMPLE_START,
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

function ViewerStrip({ card }: { card: NonNullable<Route.ComponentProps["loaderData"]["viewerCard"]> }) {
  return (
    <section className="border-b-2 border-ink bg-wall-deep">
      <div className="mx-auto max-w-6xl px-4 py-10">
        {card.progress ? (
          <GoalGrid progress={card.progress} username={card.user.username} streak={card.streak} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border-2 border-dashed border-ink p-6 sm:p-8">
            <div>
              <p className="eyebrow">No goal yet</p>
              <h1 className="font-wide mt-1 text-2xl font-black sm:text-3xl">How many slops, how many days?</h1>
              <p className="mt-2 max-w-lg text-muted">
                Pick a number and a deadline. Every day you ship leaves a splat.{" "}
                {card.streak > 0 ? `You're on a ${card.streak} day streak already.` : ""}
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
