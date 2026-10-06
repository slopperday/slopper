import { Link } from "react-router";
import type { Route } from "./+types/streaks";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { seo } from "~/lib/seo";
import { StreakList } from "~/components/StreakList";
import { useLive } from "~/components/Live";

export async function loader() {
  return { rows: await convex.query(api.goals.standings, {}) };
}

export const meta: Route.MetaFunction = ({ matches }) =>
  seo(matches, { title: "Streaks", description: "Everyone with a goal running, best run first.", path: "/streaks" });

export default function Streaks({ loaderData }: Route.ComponentProps) {
  const rows = useLive(api.goals.standings, {}, loaderData.rows);
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <p className="eyebrow">Open goals</p>
      <h1 className="font-wide mt-2 text-4xl font-black sm:text-5xl">Streaks</h1>
      <p className="mt-3 text-muted">
        Ranked by goals hit, then current streak, then how close each person is to their number.
      </p>
      <StreakList rows={rows} />
      <Link to="/goal" className="btn btn-slop mt-8">
        Get on the list
      </Link>
    </section>
  );
}
