/**
 * Generates the VAPID key pair for browser notifications.
 *
 * - Both halves go to the Convex deployment, which signs and sends every
 *   push, via `convex env set`.
 * - The public half goes into `.env.local` (or is printed with --print, for
 *   monosecret.toml, which sends it to Netlify): browsers subscribe with it.
 *
 * A new pair cuts off every browser subscribed with the old one, so run it
 * once per deployment.
 *
 *   node scripts/vapid-keys.ts                 # local dev
 *   node scripts/vapid-keys.ts --prod --print  # production deployment
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { generateVapidKeys } from "./server-keys.ts";

const args = new Set(process.argv.slice(2));
const prod = args.has("--prod");
const print = args.has("--print");

const { publicKey, privateKey } = await generateVapidKeys();

const convex = (name: string, value: string) =>
  execFileSync("node_modules/.bin/convex", ["env", "set", ...(prod ? ["--prod"] : []), "--", name, value], {
    stdio: "inherit",
  });
convex("VAPID_PUBLIC_KEY", publicKey);
convex("VAPID_PRIVATE_KEY", privateKey);

if (print) {
  console.log(`\nSet this on the app server:\nVAPID_PUBLIC_KEY=${publicKey}`);
} else {
  const path = ".env.local";
  let env = "";
  try {
    env = readFileSync(path, "utf8");
  } catch {
    // First run: no file yet.
  }
  const lines = env.split("\n").filter((line) => !line.startsWith("VAPID_PUBLIC_KEY="));
  lines.push(`VAPID_PUBLIC_KEY=${publicKey}`);
  writeFileSync(path, `${lines.join("\n").trim()}\n`);
  console.log(`Wrote the public key to ${path} and both halves to Convex.`);
}
