import netlifyReactRouter from "@netlify/vite-plugin-react-router";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import process from "node:process";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";

const IGNORED = [
  "packages/*/dist/**",
  "build/**",
  ".react-router/**",
  ".netlify/**",
  "convex/_generated/**",
  "packages/*/src/component/_generated/**",
  ".e2e/**",
  "playwright-report/**",
  "test-results/**",
];

const OG_ASSETS = "virtual:og-assets";

/**
 * The share cards' renderer and fonts (app/.server/cards.tsx), inlined into
 * the server bundle as base64. The server's dependencies stay in node_modules
 * for Netlify to trace, and a .wasm or font read at run time might not make it
 * into the function; inlined, it's there in production, tests and e2e alike.
 */
function ogAssets(): Plugin {
  const read = (file: string) => readFileSync(new URL(`node_modules/${file}`, import.meta.url)).toString("base64");
  return {
    name: "slopper:og-assets",
    resolveId: (source) => (source === OG_ASSETS ? `\0${OG_ASSETS}` : null),
    load(id) {
      if (id !== `\0${OG_ASSETS}`) return null;
      const fonts = {
        display800: read("@fontsource/big-shoulders/files/big-shoulders-latin-800-normal.woff"),
        display900: read("@fontsource/big-shoulders/files/big-shoulders-latin-900-normal.woff"),
        sans400: read("@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-400-normal.woff"),
        sans600: read("@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-600-normal.woff"),
      };
      return `export const resvgWasm = ${JSON.stringify(read("@resvg/resvg-wasm/index_bg.wasm"))};
export const fonts = ${JSON.stringify(fonts)};`;
    },
  };
}

export default defineConfig({
  // The site is the root package; `vp dev` and `vp build` (Netlify too) mean it, not packages/*.
  defaultPackage: ".",
  // React Router's plugin builds the app, and Netlify's turns the server build
  // into one Netlify Function (.netlify/v1/functions). Tests import modules directly.
  plugins: lazyPlugins(() =>
    process.env.VITEST ? [ogAssets()] : [ogAssets(), tailwindcss(), reactRouter(), netlifyReactRouter()],
  ),
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
  // Vitest runs tests/ and each package's tests; Playwright runs e2e/ against the production build.
  test: {
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.{ts,tsx}"],
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
