import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import type { TsdownPlugin } from "vite-plus/pack";

const SKILL_MODULE = fileURLToPath(new URL("src/skill.ts", import.meta.url));
const SKILL_FILE = fileURLToPath(new URL("../skill/SKILL.md", import.meta.url));

/**
 * Bundles SKILL.md into the CLI: src/skill.ts reads it from the workspace,
 * and the build replaces that module with the text. npm publishes this
 * package as it is, so a dependency on @slopperday/skill would ship as
 * `workspace:^` and break every install.
 */
function inlineSkill(): TsdownPlugin {
  let inlined = false;
  return {
    name: "slopper:inline-skill",
    buildStart() {
      inlined = false;
    },
    load(id) {
      if (id !== SKILL_MODULE) return null;
      inlined = true;
      this.addWatchFile(SKILL_FILE);
      const skill = JSON.stringify(readFileSync(SKILL_FILE, "utf8"));
      return `export async function readSkill() {\n  return ${skill};\n}\n`;
    },
    buildEnd(error) {
      if (!error && !inlined) this.error(`${SKILL_MODULE} wasn't bundled, so SKILL.md isn't in the CLI.`);
    },
  };
}

// One ESM file with a shebang and the skill inside it: no dependencies.
export default defineConfig({
  pack: {
    entry: ["src/slopper.ts"],
    format: "esm",
    platform: "node",
    target: "node22",
    dts: false,
    plugins: [inlineSkill()],
  },
});
