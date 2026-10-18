import type { Route } from "./+types/api.v1";
import { absoluteUrl } from "~/.server/config";
import { uploadImage, uploadVideo } from "~/.server/media";
import { allowAction, userForBearer } from "~/.server/tokens";
import { ApiError, asObject, type JsonObject } from "~/.server/agent/input";
import { findOperation, runOperation } from "~/.server/agent/operations";

/**
 * REST API for agents and scripts. Routes map onto the same operations the
 * MCP server exposes, so behaviour and validation are identical.
 *
 *   GET    /api/v1/me
 *   GET    /api/v1/categories
 *   GET    /api/v1/today
 *   GET    /api/v1/search?q=…&category=…   (category repeats; optional limit)
 *   POST   /api/v1/goal
 *   POST   /api/v1/media                    (raw image body, or JSON { base64 })
 *   POST   /api/v1/videos                   (raw MP4 or WebM body, or JSON { base64 })
 *   GET    /api/v1/slops
 *   POST   /api/v1/slops
 *   PATCH  /api/v1/slops/:slop
 *   PUT    /api/v1/slops/:slop/video        ({ video: id } or { video: null })
 *   POST   /api/v1/slops/:slop/updates
 *   POST   /api/v1/slops/:slop/money
 *   POST   /api/v1/slops/:slop/vote
 *   GET    /api/v1/scheduled
 *   POST   /api/v1/scheduled/:scheduled/release
 *   DELETE /api/v1/scheduled/:scheduled
 */

interface Match {
  operation: string;
  slop?: string;
  scheduled?: string;
}

function route(method: string, path: string): Match | null {
  const parts = path.split("/").filter(Boolean);
  const [resource, ref, action] = parts;
  if (method === "GET" && parts.length === 1 && resource === "me") return { operation: "whoami" };
  if (method === "GET" && parts.length === 1 && resource === "categories") return { operation: "list_categories" };
  if (method === "GET" && parts.length === 1 && resource === "today") return { operation: "todays_race" };
  if (method === "GET" && parts.length === 1 && resource === "search") return { operation: "search_slops" };
  if (method === "POST" && parts.length === 1 && resource === "goal") return { operation: "set_goal" };
  if (method === "POST" && parts.length === 1 && resource === "media") return { operation: "upload_screenshot" };
  if (method === "POST" && parts.length === 1 && resource === "videos") return { operation: "upload_video" };
  if (resource === "scheduled") {
    if (method === "GET" && parts.length === 1) return { operation: "list_scheduled" };
    if (method === "POST" && parts.length === 3 && action === "release") {
      return { operation: "release_scheduled", scheduled: ref };
    }
    if (method === "DELETE" && parts.length === 2) return { operation: "cancel_scheduled", scheduled: ref };
    return null;
  }
  if (resource !== "slops") return null;
  if (parts.length === 1) {
    if (method === "GET") return { operation: "list_my_slops" };
    if (method === "POST") return { operation: "create_slop" };
  }
  if (parts.length === 2 && method === "PATCH") return { operation: "update_slop", slop: ref };
  if (parts.length === 3 && method === "PUT" && action === "video") return { operation: "set_video", slop: ref };
  if (parts.length === 3 && method === "POST" && action === "updates") return { operation: "post_update", slop: ref };
  if (parts.length === 3 && method === "POST" && action === "money") return { operation: "log_money", slop: ref };
  if (parts.length === 3 && method === "POST" && action === "vote") return { operation: "vote", slop: ref };
  return null;
}

/** A search's query string, as the operation's input: `?q=budget&category=money&category=ai&limit=10`. */
function searchInput(params: URLSearchParams): JsonObject {
  const limit = params.get("limit");
  return {
    query: params.get("q") ?? "",
    categories: params.getAll("category"),
    ...(limit === null ? {} : { limit: /^\d+$/.test(limit) ? Number(limit) : limit }),
  };
}

function errorResponse(error: ApiError): Response {
  return Response.json({ error: error.message, details: error.details ?? null }, { status: error.status });
}

async function handle(request: Request, path: string): Promise<Response> {
  const user = await userForBearer(request);
  if (!user) {
    return Response.json(
      { error: `Missing or invalid API token. Create one at ${absoluteUrl("/settings/api")}` },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="slopper"' } },
    );
  }

  const match = route(request.method, path);
  if (!match) return errorResponse(new ApiError(404, `No endpoint for ${request.method} /api/v1/${path}`));

  try {
    if (!(await allowAction(`api:${user._id}`, 600, 3_600_000))) throw new ApiError(429, "Rate limit reached.");

    // Raw image uploads skip JSON entirely: `curl --data-binary @shot.png`.
    const contentType = request.headers.get("content-type") ?? "";
    if (match.operation === "upload_screenshot" && contentType.startsWith("image/")) {
      const result = await uploadImage(user._id, { bytes: new Uint8Array(await request.arrayBuffer()) });
      if (!result.ok) throw new ApiError(400, result.error);
      return Response.json({ id: result.id, url: result.url, nsfw: result.contentCheck === "mature" }, { status: 201 });
    }
    if (match.operation === "upload_video" && contentType.startsWith("video/")) {
      const result = await uploadVideo(user._id, new Uint8Array(await request.arrayBuffer()));
      if (!result.ok) throw new ApiError(400, result.error);
      return Response.json({ id: result.id }, { status: 201 });
    }

    let input: JsonObject = {};
    if (match.operation === "search_slops") input = searchInput(new URL(request.url).searchParams);
    if (request.method !== "GET") {
      const text = await request.text();
      try {
        input = asObject(text ? JSON.parse(text) : {}, "body");
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(400, "Body must be JSON.");
      }
    }
    if (match.slop) input = { ...input, slop: decodeURIComponent(match.slop) };
    if (match.scheduled) input = { ...input, scheduled: decodeURIComponent(match.scheduled) };

    const operation = findOperation(match.operation);
    if (!operation) throw new ApiError(404, "Unknown operation.");
    const result = await runOperation(operation, { user, now: new Date() }, input);
    return Response.json(result, { status: request.method === "POST" ? 201 : 200 });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    throw error;
  }
}

export function loader({ request, params }: Route.LoaderArgs) {
  return handle(request, params["*"] ?? "");
}

export function action({ request, params }: Route.ActionArgs) {
  return handle(request, params["*"] ?? "");
}
