/**
 * The git and deploy halves of the release workflows in monochange.toml.
 *
 *   node scripts/release.ts check                # first step of `monochange run release`
 *   node scripts/release.ts publish [--dry-run]  # last step of `monochange run publish`
 *   node scripts/release.ts deploy               # deploy HEAD again, after a failed publish
 *
 * Deploying needs `netlify login` and the 1Password service account token in
 * .env.monosecret (see monosecret.toml).
 *
 * `check` makes sure a release starts from a clean main that has everything on
 * origin/main. `publish` runs once monochange has tagged the release commit at
 * HEAD: it pushes main and the tag together, so the pre-push hook runs CI once
 * and a failure pushes neither, then deploys. `deploy` runs from this machine:
 * Convex functions first, so the app never calls one that isn't there yet,
 * then the Netlify site. It returns once slopper.day serves the release.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const SITE = new URL("/changelog", process.env.SLOPPER_URL ?? "https://slopper.day");
/** The Netlify project (slopper.netlify.app belongs to someone else). */
const NETLIFY_SITE = "slopper-day";
const DEPLOYS = `https://app.netlify.com/projects/${NETLIFY_SITE}/deploys`;
/** Netlify deploys are atomic; this only covers the CDN catching up. */
const SERVE_TIMEOUT_MS = 2 * 60_000;
const POLL_MS = 5_000;

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requireCleanMain(): void {
  const branch = git("branch", "--show-current");
  if (branch !== "main") fail(`Release from main, not ${branch || "a detached HEAD"}.`);
  // Untracked files never reach the release commit, so only tracked changes block it.
  if (git("status", "--porcelain", "--untracked-files=no")) {
    fail("Commit or stash your changes first: releases start from a clean tree.");
  }
}

function check(): void {
  requireCleanMain();
  git("fetch", "--quiet", "origin", "main");
  const behind = Number(git("rev-list", "--count", "HEAD..origin/main"));
  if (behind > 0) fail(`main is ${behind} commit(s) behind origin/main. Pull first.`);
}

function releaseVersion(): string {
  const manifest: { version?: unknown } = JSON.parse(readFileSync("package.json", "utf8"));
  if (typeof manifest.version !== "string") fail("package.json has no version.");
  return manifest.version;
}

/** The commit a tag points at, or null when there's no such tag. */
function taggedCommit(tag: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
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
function step(what: string, args: string[]): void {
  console.log(`Deploying ${what}…`);
  const result = spawnSync("pnpm", ["exec", ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    fail(`Deploying ${what} failed. Fix it, then run \`node scripts/release.ts deploy\`.`);
  }
}

async function deploy(): Promise<void> {
  const version = releaseVersion();
  // The deploy key (monosecret.toml's deploy profile) picks production, whatever .env.local selects.
  const reason = `Deploy slopper.day v${version} to Convex`;
  step("Convex", ["monosecret", "--reason", reason, "run", "--profile", "deploy", "--", "convex", "deploy"]);
  step("Netlify", ["netlify", "deploy", "--build", "--prod", "--site", NETLIFY_SITE, "--message", `v${version}`]);

  const deadline = Date.now() + SERVE_TIMEOUT_MS;
  let served = await servedVersion();
  while (served !== version) {
    if (Date.now() > deadline) {
      fail(`${SITE.origin} still serves ${served ?? "nothing"}. Check the deploy at ${DEPLOYS}.`);
    }
    await sleep(POLL_MS);
    served = await servedVersion();
  }
  console.log(`${SITE.origin} is on ${version}: ${SITE.href}`);
}

async function publish(dryRun: boolean): Promise<void> {
  const version = releaseVersion();
  const tag = `v${version}`;
  if (dryRun) {
    console.log(`Would push main and ${tag} to origin, deploy Convex and Netlify, then wait for ${SITE.origin}.`);
    return;
  }
  requireCleanMain();
  if (taggedCommit(tag) !== git("rev-parse", "HEAD")) {
    fail(`${tag} doesn't point at HEAD. Tag it with monochange first.`);
  }

  // Inherit stdio so the pre-push hook's CI run streams to the terminal.
  const push = spawnSync("git", ["push", "--atomic", "origin", "HEAD:main", `refs/tags/${tag}`], { stdio: "inherit" });
  if (push.status !== 0) fail(`Nothing was pushed. Fix what git reported above, then publish again.`);
  console.log(`Pushed main and ${tag}.`);
  await deploy();
}

const [command, ...flags] = process.argv.slice(2);
if (command === "check") check();
else if (command === "publish") await publish(flags.includes("--dry-run"));
else if (command === "deploy") await deploy();
else fail("Usage: node scripts/release.ts check | publish [--dry-run] | deploy");
