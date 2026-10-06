import { config } from "~/.server/config";
import { OPERATIONS } from "~/.server/agent/operations";

/** Plain-text guide for AI agents: what Slopper is and how to drive it. */
export function loader() {
  const origin = config.appUrl.origin;
  const tools = OPERATIONS.map((operation) => {
    const fields = Object.keys(operation.inputSchema.properties);
    const required = new Set(operation.inputSchema.required ?? []);
    const args = fields.length
      ? ` (${fields.map((field) => (required.has(field) ? field : `${field}?`)).join(", ")})`
      : "";
    return `- ${operation.name}${args}: ${operation.description}`;
  }).join("\n");

  const text = `# Slopper

> Throw slop at the wall every day. People ship small apps, sites, games and betas daily, track a goal like "30 slops in 30 days", promote them, test them with real people, and keep slopping until one is slopcessful.

## Concepts
- Slop: one shipped thing with links (website, App Store, TestFlight, Google Play, Android beta, source), screenshots, a tagline and a Markdown description.
- Goal: N slops in M days. Days end at midnight in the user's time zone.
- Slop of the day: every UTC day, slops launched that day race on votes. The leader at midnight UTC wins.
- Updates: update, feature, field (a real-world test: who tried it, what they said), repromote.
- Slopcessful: the owner declares a breakout (users, revenue, virality).
- Auto-post: updates can be posted to the user's connected X, LinkedIn and Bluesky accounts (autopost: true).

## Auth
Personal API token, created by the user at ${origin}/settings/api. Send it as: Authorization: Bearer slp_...

## MCP
Streamable HTTP endpoint: ${origin}/mcp (stateless, JSON responses)
Claude Code: claude mcp add --transport http slopper ${origin}/mcp --header "Authorization: Bearer <token>"

## Tools
${tools}

## REST
- GET    ${origin}/api/v1/me
- GET    ${origin}/api/v1/categories
- GET    ${origin}/api/v1/today
- POST   ${origin}/api/v1/goal               { target, days, startDate?, title? }
- POST   ${origin}/api/v1/media              raw image body (Content-Type: image/png…) or { base64 }
- GET    ${origin}/api/v1/slops
- POST   ${origin}/api/v1/slops              { name, tagline, category, links, description?, screenshots?, madeWith?, nsfw?, launchNote?, autopost? }
- PATCH  ${origin}/api/v1/slops/{slop}       any create_slop field
- POST   ${origin}/api/v1/slops/{slop}/updates      { kind, body, autopost? }
- POST   ${origin}/api/v1/slops/{slop}/slopcessful  { note, autopost? }
{slop} is a slop id or slug. Errors return { error, details }.

## Example: launch a site with a screenshot
curl -X POST ${origin}/api/v1/media -H "Authorization: Bearer $SLOPPER_TOKEN" -H "Content-Type: image/png" --data-binary @shot.png
curl -X POST ${origin}/api/v1/slops -H "Authorization: Bearer $SLOPPER_TOKEN" -H "Content-Type: application/json" \\
  -d '{"name":"TiltMaze","tagline":"A marble maze you play by tilting your phone","category":"games","links":[{"kind":"website","url":"https://tiltmaze.app"}],"screenshots":["<media id>"],"autopost":true}'
`;
  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
