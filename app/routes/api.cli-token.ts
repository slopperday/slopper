import { data } from "react-router";
import type { Route } from "./+types/api.cli-token";
import { collectCliLogin } from "~/.server/cliLogin";
import { convexMessage } from "~/.server/convex";
import { allowAction, callerAddress } from "~/.server/tokens";

/**
 * POST /api/cli/token, `{ deviceCode }`: the CLI's poll. `status` is
 * "pending" until the person decides, then "approved" once, with the new API
 * token, or "denied"; "expired" after ten minutes or once it's collected.
 * Each poll is a Convex read, so an address may only poll so fast — the CLI
 * asks every two seconds and a login lives ten minutes.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST" } });
  }
  if (!(await allowAction(`cli-token:${callerAddress(request)}`, 720, 3_600_000))) {
    await request.body?.cancel().catch(() => {});
    return data({ error: "Too many polls. Start again in a while." }, { status: 429 });
  }
  const body: unknown = await request.json().catch(() => null);
  const deviceCode =
    typeof body === "object" && body !== null ? (body as { deviceCode?: unknown }).deviceCode : undefined;
  if (typeof deviceCode !== "string" || !deviceCode) {
    return data({ error: "Send the `deviceCode` from /api/cli/login." }, { status: 400 });
  }
  try {
    return data(await collectCliLogin(deviceCode), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Approved, but the token couldn't be stored: the person already has as many as they can.
    const message = convexMessage(error);
    if (message === null) throw error;
    return data({ error: message }, { status: 409 });
  }
}
