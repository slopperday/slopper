import type { Route } from "./+types/auth.logout";
import { endSession } from "~/.server/session";
import { redirectWithFlash } from "~/.server/http";

export async function action({ request }: Route.ActionArgs) {
  const response = redirectWithFlash("/", { tone: "info", message: "Signed out. See you tomorrow." });
  await endSession(request, response.headers);
  return response;
}

export function loader() {
  return redirectWithFlash("/");
}
