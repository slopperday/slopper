import { data } from "react-router";
import type { Route } from "./+types/api.auth-passkey";
import {
  addPasskey,
  checkPasskey,
  finishStep,
  passkeyOptionsForStep,
  passkeyRegistrationOptions,
  pendingStep,
  recentlyVerified,
} from "~/.server/auth/twoFactor";
import { viewerContext } from "~/.server/session";
import { allowAction, callerAddress } from "~/.server/tokens";

/**
 * The passkey exchanges, as JSON for the browser's WebAuthn calls:
 * `login-options`/`login-verify` at a second-factor step (/login/verify),
 * `register-options`/`register-verify` to add one (/settings/security).
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (!(await allowAction(`passkey:${callerAddress(request)}`, 60, 3_600_000))) {
    return data({ error: "Slow down a little. Try again later." }, { status: 429 });
  }
  const viewer = context.get(viewerContext);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  switch (body?.step) {
    case "login-options": {
      const step = await pendingStep(request, viewer);
      if (!step) return data({ error: "That took too long. Sign in again." }, { status: 400 });
      return data({ options: await passkeyOptionsForStep(step) });
    }
    case "login-verify": {
      const step = await pendingStep(request, viewer);
      if (!step || typeof body.response !== "object" || body.response === null) {
        return data({ error: "That took too long. Sign in again." }, { status: 400 });
      }
      const result = await checkPasskey(step, body.response as Parameters<typeof checkPasskey>[1]);
      if (!result.ok) return data({ error: result.error }, { status: 400 });
      // The session cookie rides on this answer; the browser goes where it says.
      const done = await finishStep(request, step, result.method);
      return data({ location: done.headers.get("location") ?? "/" }, { headers: done.headers });
    }
    case "register-options": {
      if (!viewer.user) return data({ error: "Sign in first." }, { status: 401 });
      if (!(await recentlyVerified(viewer, request)))
        return data({ error: "Confirm it's you first.", confirm: true }, { status: 403 });
      return data(await passkeyRegistrationOptions(viewer.user));
    }
    case "register-verify": {
      if (!viewer.user) return data({ error: "Sign in first." }, { status: 401 });
      if (!(await recentlyVerified(viewer, request)))
        return data({ error: "Confirm it's you first.", confirm: true }, { status: 403 });
      if (typeof body.token !== "string" || typeof body.response !== "object" || body.response === null) {
        return data({ error: "That didn't arrive whole. Try again." }, { status: 400 });
      }
      const name = typeof body.name === "string" ? body.name : "Passkey";
      const result = await addPasskey(
        viewer.user,
        body.token,
        body.response as Parameters<typeof addPasskey>[2],
        name,
        request,
      );
      return data(result, { status: result.ok ? 201 : 400 });
    }
    default:
      return data({ error: "Unknown step." }, { status: 400 });
  }
}
