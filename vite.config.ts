import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig(({ command }) => ({
  plugins: lazyPlugins(() => [tailwindcss(), reactRouter()]),
  resolve: {
    tsconfigPaths: true,
  },
  // Production gets one self-contained server bundle, so Deno Deploy needs no
  // node_modules. `@deno/kv` stays external: it is only loaded on Node. Dev
  // keeps Vite's default externals, which handle CommonJS packages.
  ssr: command === "build" ? { noExternal: true, external: ["@deno/kv"] } : undefined,
  fmt: {
    printWidth: 120,
    ignorePatterns: ["build/**", ".react-router/**", "deploy/**"],
  },
  lint: {
    ignorePatterns: ["build/**", ".react-router/**", "deploy/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    env: { KV_PATH: ":memory:" },
  },
}));
