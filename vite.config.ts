import netlifyReactRouter from "@netlify/vite-plugin-react-router";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { defineConfig, lazyPlugins } from "vite-plus";

const IGNORED = [
  "build/**",
  ".react-router/**",
  ".netlify/**",
  "convex/_generated/**",
  ".e2e/**",
  "playwright-report/**",
  "test-results/**",
];

export default defineConfig({
  // React Router's plugin builds the app, and Netlify's turns the server build
  // into one Netlify Function (.netlify/v1/functions). Tests import modules directly.
  plugins: lazyPlugins(() => (process.env.VITEST ? [] : [tailwindcss(), reactRouter(), netlifyReactRouter()])),
  resolve: {
    tsconfigPaths: true,
  },
  fmt: {
    printWidth: 120,
    ignorePatterns: IGNORED,
  },
  lint: {
    ignorePatterns: IGNORED,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  // Vitest runs tests/; Playwright runs e2e/ against the production build.
  test: {
    include: ["tests/**/*.test.ts"],
  },
  // CI runs on this machine, not on GitHub: `vp run ci`, also run by the
  // pre-push hook (.vite-hooks/pre-push).
  run: {
    tasks: {
      ci: {
        command: ["react-router typegen", "vp check", "vp test", "vp build", "playwright test"],
        cache: false,
      },
      e2e: {
        command: ["vp build", "playwright test"],
        cache: false,
      },
    },
  },
  staged: {
    "*.{ts,tsx,js,json,css,md}": "vp check --fix",
  },
});
