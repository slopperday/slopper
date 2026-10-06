import type { Route } from "./+types/mcp";
import { handleMcp } from "~/.server/agent/mcp";

/** MCP endpoint: `claude mcp add --transport http slopper https://slopper.day/mcp`. */
export async function action({ request }: Route.ActionArgs) {
  return await handleMcp(request);
}

export async function loader({ request }: Route.LoaderArgs) {
  return await handleMcp(request);
}
