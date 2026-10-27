import type { FunctionArgs } from "convex/server";
import { api } from "@convex/_generated/api";
import { checkedContentHash } from "@convex/lib/shape";
import { convexApp } from "./convexApp";

type Server = ReturnType<ReturnType<typeof convexApp>["withIdentity"]>;

/** Applies the fixture verdict to the content it actually judged. */
export async function applyCurrentCheck(server: Server, args: FunctionArgs<typeof api.moderation.applyCheck>) {
  if (args.scope === "update") return server.mutation(api.moderation.applyCheck, args);
  const slop = await server.query(api.slops.getForServer, { slopId: args.slopId });
  if (!slop) throw new Error("Missing fixture launch");
  return server.mutation(api.moderation.applyCheck, { ...args, contentHash: checkedContentHash(slop) });
}

/** An already checked launch for journeys that start after moderation. */
export async function checkedLaunch(server: Server, args: FunctionArgs<typeof api.slops.create>) {
  const created = await server.mutation(api.slops.create, args);
  await applyCurrentCheck(server, { slopId: created.slopId, scope: "slop", verdict: "ok", reason: "Fixture content" });
  return created;
}
