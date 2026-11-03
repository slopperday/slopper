import { data } from "react-router";
import type { Route } from "./+types/api.studio-upload";
import { viewerContext } from "~/.server/session";
import { finishVideoUpload, startVideoUpload } from "~/.server/social/uploads";
import { allowAction, callerAddress } from "~/.server/tokens";

/**
 * The studio's video uploads, in two steps: `start` hands out where the
 * browser sends the bytes, `finish` registers them once they're there
 * (app/.server/social/uploads.ts). Pictures go through /api/media.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in first." }, { status: 401 });
  if (
    !(await allowAction(`studio-upload:ip:${callerAddress(request)}`, 120, 3_600_000)) ||
    !(await allowAction(`studio-upload:user:${user._id}`, 60, 3_600_000))
  ) {
    return data({ error: "Slow down a little. Try again later." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.step === "start") {
    const result = await startVideoUpload(
      user._id,
      typeof body.contentType === "string" ? body.contentType : "",
      Number(body.size),
    );
    return data(result, { status: result.ok ? 200 : 400 });
  }
  if (body?.step === "finish" && typeof body.ticket === "string") {
    const storageId = typeof body.storageId === "string" ? body.storageId : null;
    const result = await finishVideoUpload(user._id, body.ticket, storageId);
    return data(result, { status: result.ok ? 201 : 400 });
  }
  return data({ error: "Unknown step." }, { status: 400 });
}
