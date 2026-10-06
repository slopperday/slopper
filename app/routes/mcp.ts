import type { Route } from "./+types/mcp";
import { getKv } from "~/.server/kv";
import { handleMcp } from "~/.server/agent/mcp";

/** MCP endpoint: `claude mcp add --transport http slopper https://slopper.day/mcp`. */
export async function action({ request }: Route.ActionArgs) {
  return await handleMcp(request, await getKv());
}

export async function loader({ request }: Route.LoaderArgs) {
  return await handleMcp(request, await getKv());
}
