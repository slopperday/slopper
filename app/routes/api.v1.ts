import type { Route } from "./+types/api.v1";
import { LIMITS } from "~/lib/model";
import { uploadImage, uploadPublication, uploadVideo } from "~/.server/media";
import { allowAction, apiQuota, callerAddress, userForBearer } from "~/.server/tokens";
import { can } from "@convex/lib/permissions";
import { adminReport } from "~/.server/agent/adminAnalytics";
import { ApiError, asObject, type JsonObject } from "~/.server/agent/input";
import { findOperation, missingToken, runOperation } from "~/.server/agent/operations";

/**
 * REST API for agents and scripts. Routes map onto the same operations the
 * MCP server exposes, so behaviour and validation are identical. Public
 * reads (marked *) also work without a token, with a smaller rate limit.
 *
 *   GET    /api/v1/users/:username          *
 *   GET    /api/v1/me
 *   GET    /api/v1/categories               *
 *   GET    /api/v1/tags                     *
 *   GET    /api/v1/today                    *
 *   GET    /api/v1/search?q=…&category=…   * (category repeats; optional limit)
 *   POST   /api/v1/goal
 *   POST   /api/v1/media                    (raw image body, or JSON { base64 })
 *   POST   /api/v1/videos                   (raw MP4 or WebM body, or JSON { base64 })
 *   POST   /api/v1/publications             (raw PDF or EPUB body with ?fileName=…, or JSON { base64, fileName })
 *   GET    /api/v1/slops
 *   POST   /api/v1/slops
 *   PATCH  /api/v1/slops/:slop
 *   PUT    /api/v1/slops/:slop/video        ({ video: id } or { video: null })
 *   POST   /api/v1/slops/:slop/updates
 *   POST   /api/v1/slops/:slop/money
 *   POST   /api/v1/slops/:slop/vote
 *   GET    /api/v1/slops/:slop/reviews      *
 *   PUT    /api/v1/slops/:slop/reviews/mine
 *   GET    /api/v1/slops/:slop/analytics?days=…
 *   GET    /api/v1/scheduled
 *   POST   /api/v1/scheduled/:scheduled/release
 *   DELETE /api/v1/scheduled/:scheduled
 */

interface Match {
  operation: string;
  slop?: string;
  scheduled?: string;
  username?: string;
}

function route(method: string, path: string): Match | null {
  const parts = path.split("/").filter(Boolean);
  const [resource, ref, action] = parts;
  if (method === "GET" && parts.length === 1 && resource === "me") return { operation: "whoami" };
  if (method === "GET" && parts.length === 2 && resource === "users")
    return { operation: "get_profile", username: ref };
  if (method === "GET" && parts.length === 1 && resource === "categories") return { operation: "list_categories" };
  if (method === "GET" && parts.length === 1 && resource === "tags") return { operation: "list_tags" };
  if (method === "GET" && parts.length === 1 && resource === "today") return { operation: "todays_race" };
  if (method === "GET" && parts.length === 1 && resource === "search") return { operation: "search_slops" };
  if (method === "POST" && parts.length === 1 && resource === "goal") return { operation: "set_goal" };
  if (method === "POST" && parts.length === 1 && resource === "media") return { operation: "upload_screenshot" };
  if (method === "POST" && parts.length === 1 && resource === "videos") return { operation: "upload_video" };
  if (method === "POST" && parts.length === 1 && resource === "publications") {
    return { operation: "upload_publication" };
  }
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
  if (parts.length === 3 && method === "GET" && action === "reviews") return { operation: "list_reviews", slop: ref };
  if (parts.length === 4 && method === "PUT" && action === "reviews" && parts[3] === "mine") {
    return { operation: "review_slop", slop: ref };
  }
  if (parts.length === 3 && method === "GET" && action === "analytics") {
    return { operation: "slop_analytics", slop: ref };
  }
  if (parts.length === 3 && method === "GET" && action === "traction") return { operation: "get_traction", slop: ref };
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

function rateLimited({ error, retryAfter }: { error: string; retryAfter: number }): Response {
  return Response.json({ error, details: null }, { status: 429, headers: { "retry-after": String(retryAfter) } });
}

function unauthorized(): Response {
  return Response.json(
    { error: missingToken().message },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="slopper"' } },
  );
}

async function handle(request: Request, path: string): Promise<Response> {
  // Resolving a bearer costs a Convex call, well-formed or not, so an address
  // ceiling comes first: floods of made-up tokens can't buy Convex mutations
  // at request speed. Far above one token's quota, so shared addresses are safe.
  if (!(await allowAction(`api-pre:${callerAddress(request)}`, LIMITS.apiCallsPerHour * 4, 3_600_000))) {
    return Response.json({ error: "Rate limit reached. Try again later." }, { status: 429 });
  }
  const user = await userForBearer(request);
  // A token that doesn't work is refused even on public reads, so its owner finds out.
  if (!user && request.headers.has("authorization")) return unauthorized();

  const notFound = () => errorResponse(new ApiError(404, `No endpoint for ${request.method} /api/v1/${path}`));
  // Platform analytics for admins (app/.server/agent/adminAnalytics.ts): a 404 for everyone else.
  if (request.method === "GET" && path.replace(/\/+$/, "") === "admin/analytics") {
    if (!user || !can(user, "analytics.view")) return notFound();
    try {
      const limited = await apiQuota("api", user, request);
      if (limited) return rateLimited(limited);
      return Response.json(await adminReport(user, new URL(request.url).searchParams, new Date()));
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error);
      throw error;
    }
  }

  const match = route(request.method, path);
  if (!match) return notFound();
  const operation = findOperation(match.operation);
  if (!operation) return notFound();
  if (!user && !operation.public) return unauthorized();

  try {
    const limited = await apiQuota("api", user, request);
    if (limited) return rateLimited(limited);

    // Raw image uploads skip JSON entirely: `curl --data-binary @shot.png`.
    const contentType = request.headers.get("content-type") ?? "";
    if (user && match.operation === "upload_screenshot" && contentType.startsWith("image/")) {
      const result = await uploadImage(user._id, { bytes: new Uint8Array(await request.arrayBuffer()) });
      if (!result.ok) throw new ApiError(400, result.error);
      return Response.json({ id: result.id, url: result.url, nsfw: result.contentCheck === "mature" }, { status: 201 });
    }
    if (user && match.operation === "upload_video" && contentType.startsWith("video/")) {
      const result = await uploadVideo(user._id, new Uint8Array(await request.arrayBuffer()));
      if (!result.ok) throw new ApiError(400, result.error);
      return Response.json({ id: result.id }, { status: 201 });
    }
    const rawPublication = contentType.startsWith("application/pdf") || contentType.startsWith("application/epub+zip");
    if (user && match.operation === "upload_publication" && rawPublication) {
      const result = await uploadPublication(user._id, {
        bytes: new Uint8Array(await request.arrayBuffer()),
        fileName: new URL(request.url).searchParams.get("fileName"),
      });
      if (!result.ok) throw new ApiError(400, result.error);
      const { id, url, fileName, format } = result;
      return Response.json({ id, url, fileName, format, nsfw: result.contentCheck === "mature" }, { status: 201 });
    }

    let input: JsonObject = {};
    if (match.operation === "search_slops") input = searchInput(new URL(request.url).searchParams);
    if (match.operation === "slop_analytics") {
      const days = new URL(request.url).searchParams.get("days");
      if (days !== null) input = { days: /^\d+$/.test(days) ? Number(days) : days };
    }
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
    if (match.username) input = { ...input, username: decodeURIComponent(match.username) };

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
