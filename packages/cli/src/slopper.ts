#!/usr/bin/env node
import { homedir, hostname } from "node:os";
import process from "node:process";
import { text } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";
import { openInBrowser } from "./browser.ts";
import { main } from "./main.ts";

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  hostname: hostname(),
  fetch: globalThis.fetch,
  readStdin: async () => (process.stdin.isTTY ? null : await text(process.stdin)),
  openUrl: openInBrowser,
  sleep: async (ms) => await delay(ms),
  stdout: (output) => process.stdout.write(output),
  stderr: (output) => process.stderr.write(output),
});
