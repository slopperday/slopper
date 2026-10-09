import { launchTitle, slopPath } from "./display";
import { formatMoney } from "./money";
import type { NotificationKind } from "./notifications";

/**
 * What goes into the daily digest: everything that happened to a person's
 * slops since the last one, summed up per slop. Convex gathers the items;
 * `app/emails/digest.tsx` lays them out.
 */

export interface DigestItem {
  kind: NotificationKind;
  slop: { id: string; name: string; launchLabel: string | null; slug: string };
  /** Pledges only, in cents. */
  amount: number | null;
}

export interface SlopSummary {
  title: string;
  /** Site-relative, e.g. `/@maker/tiltmaze`. */
  path: string;
  upvotes: number;
  pledges: number;
  /** In cents. */
  pledged: number;
  feedback: number;
  kudos: number;
  won: boolean;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 upvotes, 2 pledges and 1 piece of feedback". */
function joinParts(parts: readonly string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** One slop's news in a line: "won slop of the day 🏆, 2 upvotes and 1 pledge ($25.00)". */
export function digestLine(summary: SlopSummary): string {
  const parts: string[] = [];
  if (summary.won) parts.push("won slop of the day 🏆");
  if (summary.upvotes) parts.push(count(summary.upvotes, "upvote", "upvotes"));
  if (summary.pledges) {
    parts.push(`${count(summary.pledges, "pledge", "pledges")} (${formatMoney(summary.pledged, "USD")})`);
  }
  if (summary.feedback) parts.push(count(summary.feedback, "piece of feedback", "pieces of feedback"));
  if (summary.kudos) parts.push(count(summary.kudos, "kudos", "kudos"));
  return joinParts(parts);
}

/** Per slop, wins first, then the busiest. */
export function summariseDigest(username: string, items: readonly DigestItem[]): SlopSummary[] {
  const bySlop = new Map<string, SlopSummary>();
  for (const { kind, slop, amount } of items) {
    let summary = bySlop.get(slop.id);
    if (!summary) {
      summary = {
        title: launchTitle(slop),
        path: slopPath(username, slop.slug),
        upvotes: 0,
        pledges: 0,
        pledged: 0,
        feedback: 0,
        kudos: 0,
        won: false,
      };
      bySlop.set(slop.id, summary);
    }
    if (kind === "upvote") summary.upvotes++;
    else if (kind === "pledge") {
      summary.pledges++;
      summary.pledged += amount ?? 0;
    } else if (kind === "feedback") summary.feedback++;
    else if (kind === "kudos") summary.kudos++;
    else summary.won = true;
  }
  return [...bySlop.values()].sort(
    (a, b) => Number(b.won) - Number(a.won) || b.upvotes + b.pledges - (a.upvotes + a.pledges),
  );
}

/** The subject line, and the email's headline. */
export function digestHeadline(slops: readonly SlopSummary[]): string {
  const winner = slops.find((slop) => slop.won);
  if (winner) return `🏆 ${winner.title} won slop of the day`;
  const upvotes = slops.reduce((sum, slop) => sum + slop.upvotes, 0);
  const pledges = slops.reduce((sum, slop) => sum + slop.pledges, 0);
  const news = joinParts(
    [upvotes ? count(upvotes, "upvote", "upvotes") : "", pledges ? count(pledges, "pledge", "pledges") : ""].filter(
      Boolean,
    ),
  );
  return `Your slops got ${news || "some love"}`;
}
