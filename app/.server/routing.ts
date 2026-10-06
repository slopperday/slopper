import type { Kv } from "@deno/kv";
import type { Slop, User } from "~/lib/model";
import { getUserByUsername } from "./db/users";
import { getSlopBySlug } from "./db/slops";
import { notFound } from "./http";
import type { Viewer } from "./session";

/** Resolves the `@username` path segment, or 404s. */
export async function resolveOwner(kv: Kv, segment: string | undefined): Promise<User> {
  if (!segment?.startsWith("@")) notFound();
  const user = await getUserByUsername(kv, segment.slice(1));
  if (!user) notFound();
  return user;
}

/**
 * Resolves `/@username/slug`. Hidden slops only resolve for their owner and
 * for moderators.
 */
export async function resolveSlop(
  kv: Kv,
  params: { handle?: string; slug?: string },
  viewer: Viewer,
): Promise<{ owner: User; slop: Slop }> {
  const owner = await resolveOwner(kv, params.handle);
  const slop = params.slug ? await getSlopBySlug(kv, owner.id, params.slug) : null;
  if (!slop) notFound();
  if (slop.hidden && viewer.user?.id !== owner.id && !viewer.isAdmin) notFound();
  return { owner, slop };
}
