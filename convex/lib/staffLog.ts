import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { staffActionValidator } from "../schema";

export type StaffAction = Infer<typeof staffActionValidator>;

/**
 * Records a use of a staff power in the staff log. Call it from the mutation
 * that made the change, after `requirePermission`, so the log and the change
 * commit together. `target` is what it was done to, as named now: the log
 * keeps that name even if the slop is deleted or the person renamed.
 */
export async function logStaffAction(
  ctx: MutationCtx,
  actorId: Id<"users">,
  action: StaffAction,
  target: Doc<"slops"> | Doc<"users">,
): Promise<void> {
  const name = "username" in target ? `@${target.username}` : target.name;
  await ctx.db.insert("staffActions", { actorId, action, target: name });
}
