import type { Route } from "./+types/studio.analytics-csv";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { NETWORK_LABELS } from "~/lib/networks";

const DAY = 86_400_000;

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Quote everything that could break a row, and defuse formulas spreadsheets would run.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) || safe !== text ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Every sent copy in the period with its stats and clicks, as a spreadsheet. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = [7, 28, 90, 365].includes(asked) ? asked : 90;
  const sent = await convex.query(api.social.sent, { userId: user._id, since: Date.now() + 1 - days * DAY });
  const clicks = await convex.query(api.social.clicks, {
    userId: user._id,
    postIds: [...new Set(sent.map((row) => row.postId))],
  });
  const header = [
    "sent_at",
    "network",
    "account",
    "post_id",
    "url",
    "views",
    "likes",
    "comments",
    "shares",
    "reposts",
    "saves",
    "clicks",
    "tags",
    "text",
  ];
  const rows = sent.map((row) => [
    new Date(row.sentAt).toISOString(),
    NETWORK_LABELS[row.provider],
    row.handle,
    row.postId,
    row.url,
    row.metrics?.views,
    row.metrics?.likes,
    row.metrics?.comments,
    row.metrics?.shares,
    row.metrics?.reposts,
    row.metrics?.saves,
    clicks.find((item) => item.postId === row.postId && item.provider === row.provider)?.clicks ?? "",
    row.tags.join(" "),
    row.text,
  ]);
  const body = [header, ...rows].map((line) => line.map(cell).join(",")).join("\r\n");
  return new Response(`${body}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="slopper-studio-${days}d.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
