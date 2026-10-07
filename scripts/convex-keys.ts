/**
 * Generates the ES256 key pair that lets the app server talk to Convex.
 *
 * - The private key goes into `.env.local` (or is printed with --print, for
 *   pasting into Deno Deploy's environment).
 * - The public key goes to the Convex deployment as a JWKS data URI, along
 *   with the issuer, via `convex env set`.
 *
 *   node scripts/convex-keys.ts                 # local dev
 *   node scripts/convex-keys.ts --prod --print  # production deployment
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { generateServerKeys } from "./server-keys.ts";

const args = new Set(process.argv.slice(2));
const prod = args.has("--prod");
const print = args.has("--print");
const issuer = process.env.APP_URL ?? (prod ? "https://slopper.day" : "http://localhost:5173");

const { privateKey: privateEnv, jwks, kid } = await generateServerKeys();

const convex = (name: string, value: string) =>
  execFileSync("node_modules/.bin/convex", ["env", "set", ...(prod ? ["--prod"] : []), name, value], {
    stdio: "inherit",
  });
convex("SLOPPER_JWT_ISSUER", issuer);
convex("SLOPPER_JWKS", jwks);

if (print) {
  console.log(`\nSet these on the app server:\nSLOPPER_JWT_ISSUER=${issuer}\nSLOPPER_JWT_PRIVATE_KEY=${privateEnv}`);
} else {
  const path = ".env.local";
  let env = "";
  try {
    env = readFileSync(path, "utf8");
  } catch {
    // First run: no file yet.
  }
  const lines = env.split("\n").filter((line) => !/^SLOPPER_JWT_(PRIVATE_KEY|ISSUER)=/.test(line));
  lines.push(`SLOPPER_JWT_ISSUER=${issuer}`, `SLOPPER_JWT_PRIVATE_KEY=${privateEnv}`);
  writeFileSync(path, `${lines.join("\n").trim()}\n`);
  console.log(`Wrote the private key to ${path} and the public key to Convex (kid ${kid}).`);
}
