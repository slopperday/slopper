#!/usr/bin/env node
import { homedir } from "node:os";
import process from "node:process";
import { text } from "node:stream/consumers";
import { main } from "./main.ts";

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  fetch: globalThis.fetch,
  readStdin: async () => (process.stdin.isTTY ? null : await text(process.stdin)),
  stdout: (output) => process.stdout.write(output),
  stderr: (output) => process.stderr.write(output),
});
