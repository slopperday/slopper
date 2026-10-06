import type { Route } from "./+types/auth.logout";
import { getKv } from "~/.server/kv";
import { deleteSession } from "~/.server/db/users";
import { clearCookie, readCookie, redirectWithFlash, SESSION_COOKIE } from "~/.server/http";

export async function action({ request }: Route.ActionArgs) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await deleteSession(await getKv(), token);
  const response = redirectWithFlash("/", { tone: "info", message: "Signed out. See you tomorrow." });
  clearCookie(response.headers, SESSION_COOKIE);
  return response;
}

export function loader() {
  return redirectWithFlash("/");
}
