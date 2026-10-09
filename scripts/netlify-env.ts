/**
 * Sets the production environment of the Netlify site from monosecret.toml:
 * plain values from its defaults, and secrets from the 1Password item as
 * Netlify secrets, which can't be read back. Values only reach the
 * production context and Netlify Functions.
 *
 *   vp run env:netlify             # resolve and set every variable
 *   vp run env:netlify --dry-run   # list what would be set; reads no secrets
 *
 * Needs `netlify login` and the service account token in .env.monosecret. Monosecret runs once per sync, so the shared 1Password
 * service account is read once; a failure stops here, never retries.
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

/** The Netlify project, as in scripts/release.ts. */
const NETLIFY_SITE = "slopper-day";

interface Manifest {
  profiles: { default: { secrets: Record<string, { hasDefault: boolean }> } };
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const dryRun = process.argv.includes("--dry-run");
const manifest: Manifest = JSON.parse(run("monosecret", ["manifest"]));
const declared = Object.entries(manifest.profiles.default.secrets);

if (dryRun) {
  for (const [name, { hasDefault }] of declared) console.log(`${name}${hasDefault ? "" : " (secret)"}`);
  process.exit(0);
}

const values: Record<string, string | null> = JSON.parse(
  run("monosecret", ["--reason", "Set slopper.day's production environment on Netlify", "export", "--format", "json"]),
);

let set = 0;
for (const [name, { hasDefault }] of declared) {
  const value = values[name];
  // Optional secrets that aren't in the item yet (X, the content check).
  if (!value) {
    console.log(`skip ${name}: no value`);
    continue;
  }
  const secret = hasDefault ? [] : ["--secret"];
  run("netlify", [
    "env:set",
    name,
    value,
    "--context",
    "production",
    "--scope",
    "functions",
    ...secret,
    "--site",
    NETLIFY_SITE,
    "--force",
  ]);
  console.log(`set ${name}${secret.length ? " (secret)" : ""}`);
  set++;
}
console.log(`Set ${set} variables on Netlify. Deploy again for functions to see them.`);
