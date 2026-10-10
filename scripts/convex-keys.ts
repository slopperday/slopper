/**
 * Generates the ES256 key pair that lets the app server talk to Convex.
 *
 * - The private key goes into `.env.local` (or is printed with --print, for
 *   1Password: monosecret.toml sends it to Netlify).
 * - The public key goes to the Convex deployment as a JWKS data URI, along
 *   with the issuer, via `convex env set`.
 *
 * With --add, Convex keeps trusting the keys it has, so a server still
 * signing with the old key keeps working: rotate, move every server to the
 * new key, then drop the old one from SLOPPER_JWKS.
 *
 *   node scripts/convex-keys.ts                       # local dev
 *   node scripts/convex-keys.ts --prod --print        # production deployment
 *   node scripts/convex-keys.ts --prod --add --print  # rotate production without downtime
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { generateServerKeys, jwksDataUri, parseJwksDataUri } from "./server-keys.ts";

const args = new Set(process.argv.slice(2));
const prod = args.has("--prod");
const print = args.has("--print");
const add = args.has("--add");
const issuer = process.env.APP_URL ?? (prod ? "https://slopper.day" : "http://localhost:5173");

const { privateKey: privateEnv, jwks, publicJwk, kid } = await generateServerKeys();

const target = prod ? ["--prod"] : [];
const convex = (name: string, value: string) =>
  execFileSync("node_modules/.bin/convex", ["env", "set", ...target, name, value], { stdio: "inherit" });

/** The keys Convex trusts now, which --add keeps. */
function trustedKeys(): ReturnType<typeof parseJwksDataUri> {
  const current = execFileSync("node_modules/.bin/convex", ["env", "get", ...target, "SLOPPER_JWKS"], {
    encoding: "utf8",
  }).trim();
  return current ? parseJwksDataUri(current).filter((key) => key.kid !== kid) : [];
}

convex("SLOPPER_JWT_ISSUER", issuer);
convex("SLOPPER_JWKS", add ? jwksDataUri([...trustedKeys(), publicJwk]) : jwks);

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
