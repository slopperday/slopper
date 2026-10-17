/**
 * Copy-paste prompts so an AI agent can do Slopper chores for you through
 * the MCP server or REST API. Every prompt is self-contained.
 */

function preamble(origin: string): string {
  return `Use Slopper (${origin}) to do this for me.
- Connect to the Slopper MCP server at ${origin}/mcp (HTTP transport) with the header "Authorization: Bearer <token>". In Claude Code: claude mcp add --transport http slopper ${origin}/mcp --header "Authorization: Bearer <token>"
- No MCP? Use the REST API at ${origin}/api/v1 with the same header. Docs: ${origin}/llms.txt
- If you don't have my token, ask me for one. I create it at ${origin}/settings/api.
- Call whoami first.`;
}

export function launchPrompt(origin: string): string {
  return `${preamble(origin)}

Task: launch this project as today's slop.
1. Read the project: README, package.json or pubspec.yaml, and any deployed URL, App Store, TestFlight or Play beta links you can find.
2. Take 1–3 screenshots of it running (the first is the cover) and upload each with upload_screenshot.
3. Call create_slop with a short name, a one-line tagline, a short Markdown description (what it is, why I built it, what's next), the best category (list_categories), every public link, and madeWith listing the tools used.
4. Write a launchNote in my voice, two sentences max, and set autopost: true.
5. Give me the slop URL.`;
}

export function goalPrompt(origin: string): string {
  return `${preamble(origin)}

Task: set my goal. Unless I've already said, ask me how many days I'm committing to first (7, 14, 30 or 100 are common), then how many slops in those days: safe is one every five days, getting there is one every other day, hardcore is one a day, impossible is two a day. Call set_goal, then tell me my end date and how many I need per day.`;
}

export function updatePrompt(origin: string, slop: string): string {
  return `${preamble(origin)}

Task: post an update for my slop "${slop}".
1. Look at what changed since the last release: git log, the diff, the changelog.
2. Call post_update with kind "feature" for something new (with its featureName), "update" for fixes, or "field" if I tested it with real people (ask me who tried it and how it went, for who and outcome). Set version if one shipped, and add screenshots of what changed as images (upload them first with upload_screenshot).
3. Keep the body short, concrete and in my voice. Set autopost: true.`;
}

export function editPrompt(origin: string, slop: string): string {
  return `${preamble(origin)}

Task: refresh the details of my slop "${slop}". Read the project again, then call update_slop with a sharper tagline, an updated description, current links, and new screenshots (upload them first with upload_screenshot). Only change what's out of date.`;
}

export function relaunchPrompt(origin: string, slop: string): string {
  return `${preamble(origin)}

Task: launch "${slop}" again on a new platform or as a new major version. Only real launches count (a new platform, a new app, a 2.0); features go in post_update instead.
1. Find what's new: the new store or beta links, the new version's changelog.
2. Upload fresh screenshots with upload_screenshot.
3. Call create_slop with relaunchOf set to the original slop, launchLabel set to what's launching (for example "iOS app" or "2.0"), the new links, and an updated tagline and description.
4. Write a launchNote in my voice and set autopost: true.`;
}
