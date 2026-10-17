import { createElement } from "react";
import type { Route } from "./+types/card.slop";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { notFound } from "~/.server/http";
import { cardImage, cardResponse, renderCard, SlopCard } from "~/.server/cards";
import { slopCardScreenshot } from "~/lib/cards";

/** The image a slop's link unfurls with (app/lib/cards.ts). Hidden slops have none. */
export async function loader({ params }: Route.LoaderArgs) {
  if (!params.handle.startsWith("@")) notFound();
  const page = await convex.query(api.slops.page, { username: params.handle.slice(1), slug: params.slug });
  if (!page) notFound();
  const cover = slopCardScreenshot(page.slop);
  const screenshot = cover ? await cardImage(cover) : null;
  return cardResponse(
    await renderCard(createElement(SlopCard, { slop: page.slop, username: page.owner.username, screenshot })),
  );
}
