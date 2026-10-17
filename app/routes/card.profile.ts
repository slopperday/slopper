import { createElement } from "react";
import type { Route } from "./+types/card.profile";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { notFound } from "~/.server/http";
import { cardResponse, ProfileCard, renderCard } from "~/.server/cards";
import { profileCardData } from "~/lib/cards";

/** The image a profile's link unfurls with (app/lib/cards.ts): who they are and how their goal is going. */
export async function loader({ params }: Route.LoaderArgs) {
  if (!params.handle.startsWith("@")) notFound();
  const profile = await convex.query(api.users.profile, { username: params.handle.slice(1).toLowerCase() });
  if (!profile) notFound();
  return cardResponse(await renderCard(createElement(ProfileCard, profileCardData(profile))));
}
