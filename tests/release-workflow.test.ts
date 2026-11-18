import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import authority from "../.github/release-authority.json";
import validation from "../.github/release-validation.json";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const guard = workflow.match(/name: Verify release revision[\s\S]*?        run: \|\n((?:          .*\n)+)/)?.[1];

if (!guard) throw new Error("The release workflow needs a revision guard before executing the selected checkout.");

const script = guard.replace(/^ {10}/gm, "");
const condition = workflow.match(/  publish:\n    if: >-\n((?:      .*\n)+)/)?.[1].trim();

if (!condition) throw new Error("The credentialed release job needs a main-branch gate.");

// A pre-push hook exports Git's own repository context; fixtures must never inherit it.
const gitEnvironment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  GIT_AUTHOR_NAME: "Release fixture",
  GIT_AUTHOR_EMAIL: "release@example.invalid",
  GIT_COMMITTER_NAME: "Release fixture",
  GIT_COMMITTER_EMAIL: "release@example.invalid",
};
let repository: string;
let release: string;
let main: string;
let unmerged: string;

/** Runs real Git plumbing without hooks, signing changes, or network access. */
function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8", input: "", env: gitEnvironment });

  if (result.status !== 0) throw new Error(result.stderr);

  return result.stdout.trim();
}

/** Executes the workflow's actual shell guard against a local commit graph. */
function verify(commit: string) {
  return spawnSync("bash", ["-c", script], {
    cwd: repository,
    encoding: "utf8",
    env: { ...gitEnvironment, RELEASE_COMMIT: commit },
  });
}

beforeAll(() => {
  repository = mkdtempSync(join(tmpdir(), "release-provenance-"));
  git("init", "--quiet");
  const tree = git("mktree");
  const base = git("commit-tree", tree, "-m", "chore: initial commit");
  release = git("commit-tree", tree, "-p", base, "-m", "chore(release): v1.0.0");
  main = git("commit-tree", tree, "-p", release, "-m", "fix: a later change");
  unmerged = git("commit-tree", tree, "-p", base, "-m", "chore(release): unmerged code");
  git("update-ref", "refs/remotes/origin/main", main);
});

beforeEach(() => git("checkout", "--quiet", "--detach", main));
afterAll(() => rmSync(repository, { recursive: true, force: true }));

describe("release workflow provenance", () => {
  it("requires pull requests for main with no bypass of source protection or independent CI", () => {
    expect(authority.conditions.ref_name).toEqual({ include: ["refs/heads/main"], exclude: [] });
    expect(authority.bypass_actors).toEqual([]);
    expect(authority.rules).toEqual([
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["merge", "squash", "rebase"],
          dismiss_stale_reviews_on_push: false,
          dismissal_restriction: { allowed_actors: [], enabled: false },
          require_code_owner_review: false,
          require_extra_approval_for_unattributed_changes: true,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: false,
          required_reviewers: [],
        },
      },
    ]);
    expect(validation.conditions).toEqual(authority.conditions);
    expect(validation.bypass_actors).toEqual([]);
    expect(validation.rules).toEqual([
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: "ci", integration_id: 15368 }],
        },
      },
    ]);
  });

  it("binds deployment secrets and npm's OIDC identity to the protected production environment", () => {
    expect(workflow).toMatch(/^    environment: production$/m);
    const publishing = readFileSync(new URL("../monochange.toml", import.meta.url), "utf8")
      .split("[ecosystems.npm.publish.trusted_publishing]")[1]
      .split("\n[")[0];
    expect(publishing).toContain('environment = "production"');
    expect(publishing).toContain('repository = "slopperday/slopper"');
    expect(publishing).toContain('workflow = "release.yml"');
  });

  it.each([
    ["refs/heads/main", "workflow_dispatch", "fix: latest", true],
    ["refs/heads/unmerged", "workflow_dispatch", "chore(release): v1.0.0", false],
    ["refs/tags/v1.0.0", "workflow_dispatch", "chore(release): v1.0.0", false],
    ["refs/heads/main", "push", "chore(release): v1.0.0", true],
    ["refs/heads/main", "push", "fix: latest", false],
    ["refs/heads/unmerged", "push", "chore(release): v1.0.0", false],
  ])("gates %s %s (%s) before the credentialed job starts", (ref, event, message, expected) => {
    // These operators and startsWith have the same meaning for these strings in Actions and JavaScript.
    const permitted: unknown = runInNewContext(condition, {
      github: { ref, event_name: event, event: { head_commit: { message } } },
      startsWith: (value: string, prefix: string) => value.startsWith(prefix),
    });
    expect(permitted).toBe(expected);
  });

  it("checks out the running main SHA and validates before setup or installation", () => {
    const checkout = workflow.indexOf("ref: ${{ github.sha }}");
    const verification = workflow.indexOf("name: Verify release revision");
    const setup = workflow.indexOf("uses: voidzero-dev/setup-vp@");
    const install = workflow.indexOf("run: vp install");
    const publish = workflow.indexOf("name: Publish");
    expect(checkout).toBeGreaterThan(0);
    expect(verification).toBeGreaterThan(checkout);
    expect(setup).toBeGreaterThan(verification);
    expect(install).toBeGreaterThan(setup);
    expect(publish).toBeGreaterThan(install);
    expect(workflow).toContain("RELEASE_COMMIT: ${{ inputs.commit || github.sha }}");
    expect(script).not.toContain("${{");
  });

  it("retries a merged release ancestor by checking out exactly its immutable SHA", () => {
    expect(verify(release).status).toBe(0);
    expect(git("rev-parse", "HEAD")).toBe(release);
    expect(spawnSync("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: repository, env: gitEnvironment }).status).toBe(
      1,
    );
  });

  it("accepts a release at the tip of main", () => {
    git("update-ref", "refs/remotes/origin/main", release);

    try {
      expect(verify(release).status).toBe(0);
      expect(git("rev-parse", "HEAD")).toBe(release);
    } finally {
      git("update-ref", "refs/remotes/origin/main", main);
    }
  });

  it("rejects an unmerged release before switching checkouts, even for a dry run", () => {
    const result = verify(unmerged);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("must already be merged into main");
    expect(git("rev-parse", "HEAD")).toBe(main);
  });

  it("rejects a merged non-release commit", () => {
    const result = verify(main);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Only release commits may publish");
    expect(git("rev-parse", "HEAD")).toBe(main);
  });

  it.each(["main", "refs/heads/main", "HEAD", "HEAD~1", "--help", "", "$(exit 42)", "a".repeat(39)])(
    "rejects non-SHA input %j before changing checkouts",
    (input) => {
      expect(verify(input).status).toBe(1);
      expect(git("rev-parse", "HEAD")).toBe(main);
    },
  );

  it("fails closed on an unknown SHA", () => {
    expect(verify("0".repeat(40)).status).not.toBe(0);
    expect(git("rev-parse", "HEAD")).toBe(main);
  });
});
