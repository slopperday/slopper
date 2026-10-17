import { readFile } from "node:fs/promises";

/**
 * The agent skill, packages/skill/SKILL.md. Run from source, it's read from
 * the workspace; `vp pack` swaps this module for one that holds the text
 * (vite.config.ts), so the published CLI depends on no other package.
 */
export async function readSkill(): Promise<string> {
  return await readFile(new URL("../../skill/SKILL.md", import.meta.url), "utf8");
}
