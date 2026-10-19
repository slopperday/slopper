import { data } from "react-router";
import type { Route } from "./+types/api.cli-login";
import { config } from "~/.server/config";
import { POLL_INTERVAL_S, startCliLogin } from "~/.server/cliLogin";
import { allowAction, callerAddress } from "~/.server/tokens";

/**
 * POST /api/cli/login, `{ name }`: starts a browser sign-in for the slopper
 * CLI. It answers with the secret device code the CLI polls /api/cli/token
 * with, and the page where the person approves the user code.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST" } });
  }
  if (!(await allowAction(`cli-login:${callerAddress(request)}`, 30, 3_600_000))) {
    return data({ error: "Too many sign-ins started. Try again in an hour." }, { status: 429 });
  }
  const body: unknown = await request.json().catch(() => null);
  const name = typeof body === "object" && body !== null ? (body as { name?: unknown }).name : undefined;
  if (name !== undefined && typeof name !== "string") return data({ error: "`name` should be text." }, { status: 400 });

  const login = await startCliLogin(name ?? "slopper CLI");
  const url = new URL("/cli", config.appUrl);
  url.searchParams.set("code", login.userCode);
  return data({ ...login, url: url.href, interval: POLL_INTERVAL_S });
}
