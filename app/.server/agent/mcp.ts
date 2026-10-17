import { LIMITS } from "~/lib/model";
import { absoluteUrl } from "../config";
import { allowAction, userForBearer } from "../tokens";
import { ApiError } from "./input";
import { findOperation, OPERATIONS, runOperation } from "./operations";

/**
 * A stateless MCP server over Streamable HTTP. Every request is a single
 * JSON-RPC message answered with plain JSON: no sessions and no SSE, which
 * suits a serverless host. Auth is a personal API token sent as a bearer.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER_INFO = { name: "slopper", title: "Slopper", version: "1.0.0" };

const INSTRUCTIONS = `Slopper (slopper.day) is where people throw slop at the wall every day: they ship small apps and sites daily, track a goal like "30 slops in 30 days", and keep slopping until one is slopcessful.
Start with whoami. To launch: upload_screenshot for each image, then create_slop with links (website, TestFlight, Play beta, source…). A new platform or a 2.0 is a new launch: create_slop with relaunchOf and launchLabel. Several ready at once? create_slop with releaseAt ("next" lines them up one a day) schedules them; list_scheduled, release_scheduled and cancel_scheduled manage the queue. Use post_update for fixes and features, kind "field" for real-world tests, log_money for costs and revenue. Nobody declares a slop slopcessful: the slop with the most votes when the UTC day ends wins slop of the day and goes slopcessful. todays_race shows the race, search_slops finds slops by name or by what they do, and vote spends one of the user's ${LIMITS.votesPerDay} votes a day. Pass autopost: true to post to the user's connected social accounts.`;

type JsonRpcId = string | number;

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: JsonRpcId | null;
  method?: unknown;
  params?: unknown;
}

function reply(id: JsonRpcId | null, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function fail(id: JsonRpcId | null, code: number, message: string, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function unauthorized(): Response {
  return Response.json(
    { error: "Missing or invalid API token. Create one at " + absoluteUrl("/settings/api") },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="slopper"' } },
  );
}

export async function handleMcp(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Slopper's MCP endpoint takes JSON-RPC over POST.", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  let message: JsonRpcMessage;
  try {
    const body: unknown = await request.json();
    if (Array.isArray(body) || typeof body !== "object" || body === null) {
      return fail(null, -32600, "Send one JSON-RPC message per request.");
    }
    message = body as JsonRpcMessage;
  } catch {
    return fail(null, -32700, "Body is not valid JSON.");
  }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return fail(message.id ?? null, -32600, "Not a JSON-RPC 2.0 request.");
  }

  // Notifications (no id) need no answer.
  if (message.id === undefined || message.id === null) return new Response(null, { status: 202 });
  const id = message.id;

  const user = await userForBearer(request);
  if (!user) return unauthorized();
  if (!(await allowAction(`mcp:${user._id}`, 600, 3_600_000))) {
    return fail(id, -32000, "Rate limit reached. Try again later.", 429);
  }

  const params = (typeof message.params === "object" && message.params !== null ? message.params : {}) as Record<
    string,
    unknown
  >;

  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return reply(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, {
        tools: OPERATIONS.map((operation) => ({
          name: operation.name,
          title: operation.title,
          description: operation.description,
          inputSchema: operation.inputSchema,
          annotations: {
            title: operation.title,
            readOnlyHint: operation.readOnly,
            destructiveHint: false,
            openWorldHint: !operation.readOnly,
          },
        })),
      });

    case "tools/call": {
      const operation = typeof params.name === "string" ? findOperation(params.name) : undefined;
      if (!operation) return fail(id, -32602, `Unknown tool: ${String(params.name)}`);
      try {
        const result = await runOperation(operation, { user, now: new Date() }, params.arguments);
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        const details = error.details
          ? `\n${Object.entries(error.details)
              .map(([field, problem]) => `- ${field}: ${problem}`)
              .join("\n")}`
          : "";
        return reply(id, { content: [{ type: "text", text: `${error.message}${details}` }], isError: true });
      }
    }

    default:
      return fail(id, -32601, `Method not found: ${message.method}`);
  }
}
