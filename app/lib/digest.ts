import { launchTitle, slopPath } from "./display";
import { formatMoney } from "./money";
import type { NotificationKind } from "./notifications";

/**
 * The daily digest email: everything that happened to a person's slops
 * since the last one, grouped by slop. Built in Convex, sent by Resend.
 */

export interface DigestItem {
  kind: NotificationKind;
  slop: { id: string; name: string; launchLabel: string | null; slug: string };
  /** Pledges only, in cents. */
  amount: number | null;
}

export interface DigestInput {
  username: string;
  items: readonly DigestItem[];
  /** The site's origin, for absolute links: emails have no base URL. */
  appUrl: string;
  unsubscribeUrl: string;
}

export interface DigestEmail {
  subject: string;
  text: string;
  html: string;
}

interface SlopSummary {
  title: string;
  path: string;
  upvotes: number;
  pledges: number;
  pledged: number;
  feedback: number;
  kudos: number;
  won: boolean;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 upvotes, 2 pledges ($40.00) and 1 piece of feedback". */
function joinParts(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function lineFor(summary: SlopSummary): string {
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

function summarise(username: string, items: readonly DigestItem[]): SlopSummary[] {
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
  // Wins first, then the busiest.
  return [...bySlop.values()].sort(
    (a, b) => Number(b.won) - Number(a.won) || b.upvotes + b.pledges - (a.upvotes + a.pledges),
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function composeDigest({ username, items, appUrl, unsubscribeUrl }: DigestInput): DigestEmail {
  const slops = summarise(username, items);
  const winner = slops.find((slop) => slop.won);
  const upvotes = slops.reduce((sum, slop) => sum + slop.upvotes, 0);
  const pledges = slops.reduce((sum, slop) => sum + slop.pledges, 0);
  const subject = winner
    ? `🏆 ${winner.title} won slop of the day`
    : `Your slops got ${
        joinParts(
          [
            upvotes ? count(upvotes, "upvote", "upvotes") : "",
            pledges ? count(pledges, "pledge", "pledges") : "",
          ].filter(Boolean),
        ) || "some love"
      }`;
  const url = (path: string) => new URL(path, appUrl).href;
  const settings = url("/settings#email-digest");

  const text = [
    `Here's what hit the wall since your last digest, @${username}:`,
    "",
    ...slops.map((slop) => `${slop.title}: ${lineFor(slop)}\n${url(slop.path)}`),
    "",
    `All notifications: ${url("/notifications")}`,
    "",
    "You get this at 9am your time, only on days something happened.",
    `Stop it: ${unsubscribeUrl} (or in Settings: ${settings})`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f4f5f0;color:#121410;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:520px;margin:0 auto">
<p style="margin:0 0 20px">Here's what hit the wall since your last digest, @${escapeHtml(username)}:</p>
${slops
  .map(
    (slop) =>
      `<p style="margin:0 0 16px"><a href="${escapeHtml(url(slop.path))}" style="color:#121410;font-weight:700">${escapeHtml(slop.title)}</a><br>${escapeHtml(lineFor(slop))}</p>`,
  )
  .join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(url("/notifications"))}" style="color:#121410">All notifications</a></p>
<p style="margin:0;color:#5c6157;font-size:13px">You get this at 9am your time, only on days something happened. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#5c6157">Stop these emails</a> or change it in <a href="${escapeHtml(settings)}" style="color:#5c6157">Settings</a>.</p>
</div>
</body>
</html>`;

  return { subject, text, html };
}
