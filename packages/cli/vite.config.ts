import { defineConfig } from "vite-plus";

// One ESM file with a shebang; the skill stays a dependency, read at runtime.
export default defineConfig({
  pack: {
    entry: ["src/slopper.ts"],
    format: "esm",
    platform: "node",
    target: "node22",
    dts: false,
  },
});
