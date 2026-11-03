import { data } from "react-router";
import type { Route } from "./+types/api.studio-assist";
import { api } from "@convex/_generated/api";
import { config } from "~/.server/config";
import { convex } from "~/.server/convex";
import { viewerContext } from "~/.server/session";
import { assist, isAssistAction } from "~/.server/social/assist";
import { allowAction } from "~/.server/tokens";
import { isSocialProvider } from "~/lib/networks";

/** The studio's writing assistant. It only fills the composer; posting still runs the content check. */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in first." }, { status: 401 });
  if (!config.contentCheck)
    return data({ error: "The writing assistant isn't set up on this server." }, { status: 503 });
  if (!(await allowAction(`studio-assist:${user._id}`, 60, 3_600_000))) {
    return data({ error: "That's a lot of rewrites for one hour. Try again later." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!isAssistAction(action) || !text) return data({ error: "Write something first." }, { status: 400 });
  const network = typeof body?.network === "string" && isSocialProvider(body.network) ? body.network : null;
  const brand = typeof body?.brand === "string" ? body.brand : "";
  const voice = brand
    ? ((await convex.query(api.studio.brands, { userId: user._id })).find((item) => item.name === brand)?.voice ?? null)
    : null;
  try {
    return data(await assist({ action, text, voice, network }, config.contentCheck));
  } catch (error) {
    console.warn("The writing assistant failed", error);
    return data({ error: "The assistant didn't answer just now. Try again." }, { status: 502 });
  }
}
