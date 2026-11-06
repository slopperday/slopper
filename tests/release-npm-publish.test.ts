import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const config = readFileSync(new URL("../monochange.toml", import.meta.url), "utf8");
const script = readFileSync(new URL("../scripts/release.ts", import.meta.url), "utf8");

describe("npm publishing", () => {
  it("publishes the npm packages with the npm CLI after monochange", () => {
    const monochange = workflow.indexOf("vp exec monochange");
    const publishNpm = workflow.indexOf("release.ts publish-npm");
    expect(monochange).toBeGreaterThan(0);
    // monochange skips the external packages, so the npm step must follow it in the same job.
    expect(publishNpm).toBeGreaterThan(monochange);
  });

  it("marks both npm packages external so pnpm never publishes them", () => {
    for (const name of ["@slopperday/cli", "@slopperday/skill"]) {
      const section = config.slice(config.indexOf(`[package."${name}"]`));
      const next = section.indexOf("\n[", 1);
      expect(section.slice(0, next < 0 ? undefined : next)).toContain('publish = { mode = "external" }');
    }
  });

  it("checks the release tag before publishing, so retried runs skip old packages", () => {
    // The tag check is what keeps a retry on main from republishing a package
    // whose release isn't at HEAD.
    expect(script).toContain("taggedCommit(`${tag}/v${current}`) !== head");
    expect(script).toMatch(/npm", \["publish", "--access", "public"\]/);
  });
});
