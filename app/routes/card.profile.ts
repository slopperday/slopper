import { createElement } from "react";
import { redirect } from "react-router";
import type { Route } from "./+types/card.profile";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { notFound } from "~/.server/http";
import { allowAction, callerAddress } from "~/.server/tokens";
import { cardResponse, ProfileCard, renderCard } from "~/.server/cards";
import { profileCardData, profileCardVersion } from "~/lib/cards";

/**
 * The image a profile's link unfurls with (app/lib/cards.ts): who they are
 * and how their goal is going. As with slop cards, only the version the page
 * hands out renders; anything else is redirected to it.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!params.handle.startsWith("@")) notFound();
  if (!(await allowAction(`card:${callerAddress(request)}`, 240, 3_600_000))) {
    throw new Response("Too many card requests. Try again later.", { status: 429 });
  }
  const profile = await convex.query(api.users.profile, { username: params.handle.slice(1).toLowerCase() });
  if (!profile) notFound();
  const card = profileCardData(profile);
  const asked = new URL(request.url).searchParams.get("v");
  if (asked !== null && asked !== profileCardVersion(card)) {
    return redirect(`/@${card.username}/card.png?v=${profileCardVersion(card)}`, 301);
  }
  return cardResponse(await renderCard(createElement(ProfileCard, card)));
}
