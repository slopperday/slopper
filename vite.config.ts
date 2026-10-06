import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig(({ command }) => ({
  // React Router's plugin builds the app; tests import modules directly.
  plugins: lazyPlugins(() => (process.env.VITEST ? [] : [tailwindcss(), reactRouter()])),
  resolve: {
    tsconfigPaths: true,
  },
  // Production gets one self-contained ESM server bundle (server/app.ts), so
  // Deno Deploy needs no node_modules. Dev keeps Vite's default externals.
  ssr: command === "build" ? { noExternal: true } : undefined,
  environments: {
    ssr: { build: { rollupOptions: { input: "./server/app.ts" } } },
  },
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
  },
}));
