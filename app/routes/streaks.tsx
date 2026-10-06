import { Link } from "react-router";
import type { Route } from "./+types/streaks";
import { getKv } from "~/.server/kv";
import { standings } from "~/.server/leaderboard";
import { memo } from "~/.server/memo";
import { seo } from "~/lib/seo";
import { StreakList } from "~/components/StreakList";

export async function loader() {
  const kv = await getKv();
  return { rows: await memo("home:standings", 30_000, () => standings(kv)) };
}

export const meta: Route.MetaFunction = ({ matches }) =>
  seo(matches, { title: "Streaks", description: "Everyone with a goal running, best run first.", path: "/streaks" });

export default function Streaks({ loaderData }: Route.ComponentProps) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <p className="eyebrow">Open goals</p>
      <h1 className="font-wide mt-2 text-4xl font-black sm:text-5xl">Streaks</h1>
      <p className="mt-3 text-muted">
        Ranked by goals hit, then current streak, then how close each person is to their number.
      </p>
      <StreakList rows={loaderData.rows} />
      <Link to="/goal" className="btn btn-slop mt-8">
        Get on the list
      </Link>
    </section>
  );
}
