/**
 * The git and deploy halves of the release workflows in monochange.toml.
 *
 *   node scripts/release.ts branch [--dry-run]  # first step of `monochange run release`
 *   node scripts/release.ts pr [--dry-run]      # last step of `monochange run release`
 *   node scripts/release.ts ci [--dry-run]      # first step of `monochange run publish`
 *   node scripts/release.ts deploy [--if-released] [--dry-run]
 *   node scripts/release.ts publish-npm [--dry-run]  # publishes the released npm packages
 *
 * A release is a pull request. `monochange run release` starts on a clean,
 * up-to-date main: `branch` moves to the release branch, monochange bumps the
 * versions, writes the changelogs and commits there, and `pr` pushes it (the
 * pre-push hook runs CI) and opens the pull request, or updates the open one.
 * .github/workflows/release-merge.yml merges it once its required check reports.
 *
 * Merging it puts the release commit on main, where
 * .github/workflows/release.yml runs `monochange run publish`: `ci` makes sure
 * that's where it is, monochange tags the commit, `deploy --if-released`
 * deploys the site when this release has a site tag, and `publish-npm`
 * publishes the released npm packages with the npm CLI (see its comment).
 *
 * `deploy` puts the Convex functions up first, so the app never calls one that
 * isn't there yet, then builds and deploys Netlify, and returns once
 * slopper.day serves the release. The workflow passes CONVEX_DEPLOY_KEY and
 * NETLIFY_AUTH_TOKEN; run by hand, it reads the deploy key through monosecret
 * (.env.monosecret, see monosecret.toml) and uses your `netlify login`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const SITE = new URL("/changelog", process.env.SLOPPER_URL ?? "https://slopper.day");
/** The Netlify project "slopper-day" (slopper.netlify.app belongs to someone else). Builds need the id, not the name. */
const NETLIFY_SITE = "20e2e1d0-81fc-4370-a6f4-ea00cff5716d";
const DEPLOYS = "https://app.netlify.com/projects/slopper-day/deploys";
/** Netlify deploys are atomic; this only covers the CDN catching up. */
const SERVE_TIMEOUT_MS = 2 * 60_000;
const POLL_MS = 5_000;
/** Every release pull request comes from this branch; starting a release resets it to main. */
const RELEASE_BRANCH = "chore/release";
/** CommitRelease's subject starts with this, and so does the pull request title it's squash-merged under. */
const RELEASE_SUBJECT = "chore(release):";
/** The release owners whose version decides the title: monochange tags `v1.2.3` and `cli/v1.2.3`. */
const RELEASED = [
  { manifest: "package.json", name: (version: string) => `v${version}` },
  { manifest: "packages/cli/package.json", name: (version: string) => `cli v${version}` },
];
/** The npm packages monochange skips (publish mode "external"); both tag as `cli/v1.2.3`. */
const NPM_PACKAGES = [
  { dir: "packages/cli", tag: "cli" },
  { dir: "packages/skill", tag: "cli" },
];

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function gh(...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function version(manifest: string): unknown {
  const parsed: { version?: unknown } = JSON.parse(manifest);
  return parsed.version;
}

function siteVersion(): string {
  const current = version(readFileSync("package.json", "utf8"));
  if (typeof current !== "string") fail("package.json has no version.");
  return current;
}

function isReleaseCommit(): boolean {
  return git("log", "-1", "--format=%s").startsWith(RELEASE_SUBJECT);
}

/** The commit a tag points at, or null when there's no such tag. */
function taggedCommit(tag: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Starts a release from a clean main that matches origin/main and has changesets to release. */
function branch(dryRun: boolean): void {
  if (git("branch", "--show-current") !== "main") fail("Start a release from main.");
  // Untracked files never reach the release commit, so only tracked changes block it.
  if (git("status", "--porcelain", "--untracked-files=no")) {
    fail("Commit or stash your changes first: releases start from a clean tree.");
  }
  git("fetch", "--quiet", "origin", "main");
  const [behind = 0, ahead = 0] = git("rev-list", "--left-right", "--count", "origin/main...HEAD")
    .split(/\s+/)
    .map(Number);
  if (behind > 0) fail(`main is ${behind} commit(s) behind origin/main. Pull first.`);
  if (ahead > 0) fail(`main has ${ahead} commit(s) that aren't on origin/main. Releases only ship merged work.`);
  if (!readdirSync(".changeset").some((name) => name.endsWith(".md"))) fail("Nothing to release: .changeset is empty.");
  if (dryRun) {
    console.log(`Would start ${RELEASE_BRANCH} from main at ${git("rev-parse", "--short", "HEAD")}.`);
    return;
  }
  // -C resets the branch to main, so a new release replaces an unmerged one instead of stacking on it.
  git("switch", "--quiet", "-C", RELEASE_BRANCH);
  console.log(`On ${RELEASE_BRANCH}, from main at ${git("rev-parse", "--short", "HEAD")}.`);
}

/** Pushes the release commit and opens its pull request, or updates the open one. */
function pr(dryRun: boolean): void {
  if (dryRun) {
    console.log(`Would push ${RELEASE_BRANCH} (the pre-push hook runs CI) and open or update its pull request.`);
    return;
  }
  if (git("branch", "--show-current") !== RELEASE_BRANCH) fail(`Open the release pull request from ${RELEASE_BRANCH}.`);
  if (!isReleaseCommit()) fail("HEAD isn't a release commit. Were there any changesets?");

  const released = RELEASED.flatMap(({ manifest, name }) => {
    const now = version(readFileSync(manifest, "utf8"));
    return typeof now === "string" && now !== version(git("show", `HEAD~1:${manifest}`)) ? [name(now)] : [];
  });
  const title = `${RELEASE_SUBJECT} ${released.join(", ")}`;
  const body = [
    git("log", "-1", "--format=%b"),
    "",
    "Merging this runs `.github/workflows/release.yml`: it tags the release, deploys Convex and Netlify when the site " +
      "is part of it, and publishes released npm packages with trusted publishing.",
  ].join("\n");

  // GitHub deletes the branch when a release pull request merges, so refresh what we know of it: the lease below
  // compares against origin/chore/release, and a stale copy of a deleted branch refuses the push.
  git("fetch", "--quiet", "--prune", "origin");
  // The pre-push hook runs CI on the release commit; a failure pushes nothing.
  const push = spawnSync("git", ["push", "--force-with-lease", "--set-upstream", "origin", RELEASE_BRANCH], {
    stdio: "inherit",
  });
  if (push.status !== 0) fail("Nothing was pushed. Fix what git reported above, then run the release again.");

  const open = gh("pr", "list", "--head", RELEASE_BRANCH, "--state", "open", "--json", "url", "--jq", '.[0].url // ""');
  if (open) gh("pr", "edit", open, "--title", title, "--body", body);
  const url = open || gh("pr", "create", "--base", "main", "--head", RELEASE_BRANCH, "--title", title, "--body", body);
  git("switch", "--quiet", "main");
  console.log(`${open ? "Updated" : "Opened"} ${url}. It merges itself to publish.`);
}

/**
 * `monochange run publish` pushes tags and deploys, so it only runs in the release workflow, on a release commit
 * that's on main. A dry run (rehearsing a release pull request) skips the last check.
 */
function ci(dryRun: boolean): void {
  if (process.env.GITHUB_ACTIONS !== "true") {
    fail("`monochange run publish` runs in .github/workflows/release.yml. Merge the release pull request instead.");
  }
  if (!isReleaseCommit()) fail("HEAD isn't a release commit.");
  if (dryRun) return;
  git("fetch", "--quiet", "origin", "main");
  if (spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"]).status !== 0) {
    fail("Only release commits on main are published. Merge the release pull request first.");
  }
}

/** The release slopper.day is serving, or null while it can't be reached. */
async function servedVersion(): Promise<string | null> {
  try {
    const response = await fetch(SITE, { cache: "no-store" });
    return response.headers.get("x-slopper-version");
  } catch (error) {
    // fetch rejects only on network failures; keep waiting until the deadline.
    console.warn(`Couldn't reach ${SITE.origin}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Runs one deploy step with its output in the terminal; stops at the first failure. */
function step(what: string, args: string[], cwd = "."): void {
  console.log(`Deploying ${what}…`);
  const result = spawnSync("pnpm", ["exec", ...args], { cwd, stdio: "inherit" });
  if (result.status !== 0) fail(`Deploying ${what} failed. Fix it, then run \`node scripts/release.ts deploy\`.`);
}

async function deploy(ifReleased: boolean, dryRun: boolean): Promise<void> {
  const current = siteVersion();
  if (dryRun) {
    // A dry run tags nothing, so it can't tell yet whether the site is in the release.
    console.log(`Would deploy Convex, then Netlify, and wait for ${SITE.origin} to serve ${current}.`);
    return;
  }
  if (ifReleased && taggedCommit(`v${current}`) !== git("rev-parse", "HEAD")) {
    console.log(`This release doesn't change the site (no v${current} tag at HEAD), so there's nothing to deploy.`);
    return;
  }
  // The deploy key picks production, whatever .env.local selects. The workflow passes it; by hand, monosecret reads it.
  const withDeployKey = process.env.CONVEX_DEPLOY_KEY
    ? []
    : ["monosecret", "--reason", `Deploy slopper.day v${current} to Convex`, "run", "--profile", "deploy", "--"];
  step("Convex", [...withDeployKey, "convex", "deploy"]);
  // Counts "Made with" tags the first time there's a table for them; a no-op on every later deploy.
  step("Convex tag counts", [...withDeployKey, "convex", "run", "tags:backfill"]);
  // From the repo root, netlify-cli sees the workspace packages (packages/*), asks which one to deploy, and fails
  // in CI. It skips that question when --cwd names a directory it wasn't started in, so it starts in scripts/ and
  // --cwd points it back at the app.
  const app = process.cwd();
  const netlify = [
    "netlify",
    "deploy",
    "--build",
    "--prod",
    "--site",
    NETLIFY_SITE,
    "--cwd",
    app,
    "--message",
    `v${current}`,
  ];
  step("Netlify", netlify, "scripts");

  const deadline = Date.now() + SERVE_TIMEOUT_MS;
  let served = await servedVersion();
  while (served !== current) {
    if (Date.now() > deadline) {
      fail(`${SITE.origin} still serves ${served ?? "nothing"}. Check the deploy at ${DEPLOYS}.`);
    }
    await sleep(POLL_MS);
    served = await servedVersion();
  }
  console.log(`${SITE.origin} is on ${current}: ${SITE.href}`);
}

/**
 * Publishes the released npm packages with the npm CLI. monochange publishes
 * pnpm-workspace packages with `pnpm publish`, and pnpm 11+ no longer records
 * the publishing commit (gitHead) on the registry — installs pinned to that
 * commit (the dotfiles skill sync) refused every release after 0.1.8. npm
 * stamps gitHead from HEAD, so monochange's publish mode for these packages is
 * "external" and this runs in the release workflow, after the tag push. Like
 * `deploy --if-released`, a package whose release tag isn't at HEAD isn't part
 * of this release and is skipped.
 */
function publishNpm(dryRun: boolean): void {
  const head = git("rev-parse", "HEAD");
  for (const { dir, tag } of NPM_PACKAGES) {
    const manifest = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as { name?: unknown; version?: unknown };
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      fail(`${dir}/package.json has no name and version.`);
    }
    const { name, version: current } = manifest;
    if (dryRun) {
      console.log(`Would npm-publish ${dir} v${current} once ${tag}/v${current} tags this commit.`);
      continue;
    }
    if (taggedCommit(`${tag}/v${current}`) !== head) {
      console.log(
        `${dir} v${current} isn't in this release (no ${tag}/v${current} tag at HEAD), so there's nothing to publish.`,
      );
      continue;
    }
    // A retry after one package published but a later one failed must not die
    // on the duplicate, so skip whatever npm already has.
    const onNpm = spawnSync("npm", ["view", `${name}@${current}`, "version"], { encoding: "utf8" });
    if (onNpm.status === 0) {
      console.log(`${name} v${current} is already on npm.`);
      continue;
    }
    console.log(`Publishing ${dir} v${current} with npm…`);
    const result = spawnSync("npm", ["publish", "--access", "public"], { cwd: dir, stdio: "inherit" });
    if (result.status !== 0) {
      fail(`Publishing ${dir} failed. Fix it, then rerun \`node scripts/release.ts publish-npm\`.`);
    }
  }
}

const [command, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (command === "branch") branch(dryRun);
else if (command === "pr") pr(dryRun);
else if (command === "ci") ci(dryRun);
else if (command === "deploy") await deploy(flags.includes("--if-released"), dryRun);
else if (command === "publish-npm") publishNpm(dryRun);
else
  fail("Usage: node scripts/release.ts branch | pr | ci | deploy [--if-released] | publish-npm, each with [--dry-run]");
