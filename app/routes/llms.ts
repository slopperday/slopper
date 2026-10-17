import { autopostNetworks, config } from "~/.server/config";
import { listWords } from "~/lib/display";
import { LIMITS } from "~/lib/model";
import { OPERATIONS } from "~/.server/agent/operations";

/** Plain-text guide for agents: what Slopper is and how to drive it. */
export function loader() {
  const origin = config.appUrl.origin;
  // The CLI talks to slopper.day unless told otherwise.
  const cliUrl = origin === "https://slopper.day" ? null : origin;
  const tools = OPERATIONS.map((operation) => {
    const fields = Object.keys(operation.inputSchema.properties);
    const required = new Set(operation.inputSchema.required ?? []);
    const args = fields.length
      ? ` (${fields.map((field) => (required.has(field) ? field : `${field}?`)).join(", ")})`
      : "";
    return `- ${operation.name}${args}: ${operation.description}`;
  }).join("\n");

  const text = `# Slopper

> Too much slop? Not enough yet! People ship small apps, sites, games and betas every day toward a goal like "30 slops in 30 days", promote them, test them with real people, and keep slopping until one is slopcessful.

## Concepts
- Slop: one shipped thing with links (website, App Store, TestFlight, Google Play, Android beta, source), screenshots, a tagline and a Markdown description.
- Goal: N slops in M days. Days end at midnight in the user's time zone. Every slop counts, so three out in one day are three.
- Scheduled launches: a ready slop can go out later, at a set time or on the next free day as its race starts. Only the user sees it until then, and it counts on the day it goes out.
- Slop of the day: every UTC day, slops launched that day race on votes. The leader at midnight UTC wins.
- Votes: everyone gets ${LIMITS.votesPerDay} a day (UTC), up or private down. Switching today's vote is free and clearing it gives it back.
- Updates: update, feature, field (a real-world test: who tried it, what they said), repromote.
- Slopcessful: winning slop of the day makes a slop slopcessful. Nobody can declare it.
- Auto-post: launches and updates can post to the user's connected ${listWords(autopostNetworks(), "and")} accounts (autopost: true). Each one passes an automated content check first; anything that fails it, or has been flagged, is never auto-posted.
- Screenshots are checked on upload: explicit or hateful images are refused, and a mature one blurs any slop that shows it.

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
- POST   ${origin}/api/v1/media              raw image body (Content-Type: image/png…) or { base64 } → { id, url, contentCheck }
- POST   ${origin}/api/v1/videos             raw MP4 or WebM body (Content-Type: video/mp4…, up to 4 MB) or { base64 } → { id }
- GET    ${origin}/api/v1/slops
- POST   ${origin}/api/v1/slops              { name, tagline, category, links, description?, screenshots?, madeWith?, launchNote?, releaseAt?, autopost? }
- PATCH  ${origin}/api/v1/slops/{slop}       any create_slop field
- PUT    ${origin}/api/v1/slops/{slop}/video        { video: id | null }; your first video is pending until a moderator approves it, then live; later ones are live at once if they pass the video check
- POST   ${origin}/api/v1/slops/{slop}/updates      { kind, body, autopost? }
- POST   ${origin}/api/v1/slops/{slop}/money        { kind: "cost" | "revenue", amount, currency?, category?, note?, date? }
- POST   ${origin}/api/v1/slops/{slop}/vote         { vote: "up" | "down" | "clear" }
- GET    ${origin}/api/v1/scheduled
- POST   ${origin}/api/v1/scheduled/{scheduled}/release
- DELETE ${origin}/api/v1/scheduled/{scheduled}
{slop} is one of your slops' id or slug, or for vote any slop's id (from /today). releaseAt schedules a launch: "next" (the next free day, as its race starts) or an ISO 8601 date-time; {scheduled} is its id. Errors return { error, details }.

## CLI
slopper (npm: @slopperday/cli) runs these operations from a terminal and prints JSON. Run it without installing it:
- npx -y @slopperday/cli <command>   (-y: npx asks "Ok to proceed?" before it installs, and waits for an answer in a terminal)
- pnpm dlx @slopperday/cli <command>
- bunx @slopperday/cli <command>
- yarn dlx -q @slopperday/cli <command>   (-q: keeps yarn's install log out of the JSON on stdout)
- deno run -A npm:@slopperday/cli <command>
- or install it once, npm i -g @slopperday/cli, and run slopper <command>

slopper login${cliUrl ? ` --url ${cliUrl}` : ""}   (opens the browser on a one-time code; once the user approves it, saves a token readable by them only. --no-browser prints the link instead)
slopper login --token slp_...${cliUrl ? ` --url ${cliUrl}` : ""}   (or check and save a token made at /settings/api)
SLOPPER_TOKEN=slp_...${cliUrl ? ` SLOPPER_URL=${cliUrl}` : ""} slopper whoami   (saves nothing: for agents that shouldn't write a config file)
slopper help   (every command and its flags)
slopper skill   (the agent skill, also on npm as @slopperday/skill)

## Example: launch a site with a screenshot
curl -X POST ${origin}/api/v1/media -H "Authorization: Bearer $SLOPPER_TOKEN" -H "Content-Type: image/png" --data-binary @shot.png
curl -X POST ${origin}/api/v1/slops -H "Authorization: Bearer $SLOPPER_TOKEN" -H "Content-Type: application/json" \\
  -d '{"name":"TiltMaze","tagline":"A marble maze you play by tilting your phone","category":"games","links":[{"kind":"website","url":"https://tiltmaze.app"}],"screenshots":["<media id>"],"autopost":true}'
`;
  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
