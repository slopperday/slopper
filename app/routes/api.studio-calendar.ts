import type { Route } from "./+types/api.studio-calendar";
import { api } from "@convex/_generated/api";
import { absoluteUrl } from "~/.server/config";
import { convex } from "~/.server/convex";
import { allowAction, callerAddress } from "~/.server/tokens";
import { calendarFeed } from "~/lib/ics";
import { NETWORK_LABELS } from "~/lib/networks";

/**
 * A person's studio calendar as an iCalendar feed, for their calendar app.
 * The secret in the address is the only key; revoking it in Studio settings
 * turns the address off. Calendar apps poll, so the ceiling is generous.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!(await allowAction(`studio-calendar:${callerAddress(request)}`, 240, 3_600_000))) {
    return new Response("Slow down a little.", { status: 429 });
  }
  const token = params.token.replace(/\.ics$/, "");
  const events = await convex.query(api.studio.calendarFeed, { token });
  if (!events) return new Response("Not found", { status: 404 });
  const body = calendarFeed(
    events.map((event) => ({
      id: event.id,
      at: event.at,
      text: event.text,
      networks: event.networks.map((provider) => NETWORK_LABELS[provider]),
      url: absoluteUrl(`/studio/posts/${event.id}`),
    })),
  );
  return new Response(body, {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300" },
  });
}
