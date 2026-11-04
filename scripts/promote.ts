/**
 * Drafts the Slopper Studio announcement in your studio, as an idea with a
 * version for each network, so you pick the accounts and post it from
 * slopper.day/studio. Runs the CLI in this checkout, signed in with
 * `node packages/cli/src/slopper.ts login`.
 *
 *   vp run promote                      # links slopper.day/studio
 *   vp run promote -- https://slopper.day/@you/slopper-studio
 *
 * Running it again the same day returns the same draft (an idempotency key).
 */
import { spawnSync } from "node:child_process";

const link = process.argv[2] ?? "https://slopper.day/studio";
const day = new Date().toISOString().slice(0, 10);

const text =
  "Slopper Studio is live: write one post and send it to X, LinkedIn, Bluesky, Threads, Facebook, Instagram, TikTok, YouTube, Mastodon, Discord, Telegram and Reddit, as every brand you run. A checklist says what each network still needs, and your launches can post themselves. Free, except what X charges for its API.";

const copies = {
  x: "Slopper Studio is live: one post, every network, every brand you run. Free (X bills its own API).",
  bluesky:
    "Slopper Studio is live: write once, post to Bluesky, X, LinkedIn, Threads, Mastodon and 7 more, as every brand you run. Free.",
  linkedin:
    "Today on Slopper: the Studio. Connect the accounts you post as (yours, each product's, each client's), write one post, and each network gets a copy that fits it. A checklist says what each one still needs, launches can post themselves, and every link counts its clicks per network.\n\nIt's free. The only cost is X, which bills your own X developer app per post.",
  reddit:
    "I built multi-account social posting into Slopper: one post to 12 networks, each copy fitted to its network, with a readiness checklist and tracked links. Free apart from X's API fees. Feedback welcome.",
};

function cli(args: string[]): string {
  const result = spawnSync("node", ["packages/cli/src/slopper.ts", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const created = JSON.parse(
  cli([
    "social",
    "post",
    text,
    "--link",
    link,
    "--at",
    "draft",
    "--track-links",
    "--tag",
    "launch",
    "--tag",
    "studio",
    "--key",
    `promote-studio-${day}`,
  ]),
) as { id?: string; post?: { id: string } };
const id = created.post?.id ?? created.id;
if (!id) {
  console.error("The studio didn't say which draft it made:", created);
  process.exit(1);
}
cli(["social", "edit", id, ...Object.entries(copies).flatMap(([network, words]) => ["--copy", `${network}=${words}`])]);
console.log(`Drafted. Pick the accounts, add the demo video and post it: https://slopper.day/studio/posts/${id}`);
