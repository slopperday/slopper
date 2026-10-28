import { createElement } from "react";
import { redirect } from "react-router";
import type { Route } from "./+types/card.slop";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { notFound } from "~/.server/http";
import { allowAction, callerAddress } from "~/.server/tokens";
import { cardImage, cardResponse, renderCard, SlopCard } from "~/.server/cards";
import { slopCardPath, slopCardScreenshot } from "~/lib/cards";

/**
 * The image a slop's link unfurls with (app/lib/cards.ts). Hidden slops have
 * none. Any other version than the card's own is redirected to it, so the
 * only URLs that render (and fill the CDN) are the one the page hands out —
 * a flood of made-up `?v=`s can't make the server draw.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!params.handle.startsWith("@")) notFound();
  // Drawing is CPU the one server function pays for, so each address gets a ceiling.
  if (!(await allowAction(`card:${callerAddress(request)}`, 240, 3_600_000))) {
    throw new Response("Too many card requests. Try again later.", { status: 429 });
  }
  const page = await convex.query(api.slops.card, { username: params.handle.slice(1), slug: params.slug });
  if (!page) notFound();
  const canonical = slopCardPath(page.owner.username, page.slop);
  const asked = new URL(request.url);

  // Compare the raw path and query: parsing v alone lets cache-busting variants render.
  if (`${asked.pathname}${asked.search}` !== canonical) {
    return redirect(canonical, 301);
  }
  const cover = slopCardScreenshot(page.slop);
  const screenshot = cover ? await cardImage(cover) : null;
  return cardResponse(
    await renderCard(createElement(SlopCard, { slop: page.slop, username: page.owner.username, screenshot })),
  );
}
