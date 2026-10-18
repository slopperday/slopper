/**
 * Sets the production environment of the Netlify site from monosecret.toml:
 * plain values from its defaults, and secrets from the 1Password item as
 * Netlify secrets, which can't be read back. Values only reach the
 * production context. No `--scope`: netlify-cli 27 exits 0 without setting
 * anything when it's given, so every variable is checked once it's set.
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
const NETLIFY_SITE = "20e2e1d0-81fc-4370-a6f4-ea00cff5716d";

interface Manifest {
  profiles: { default: { secrets: Record<string, { hasDefault: boolean }> } };
}

/** Whether a value decodes the way app/.server/convex.ts reads SLOPPER_JWT_PRIVATE_KEY. */
function isPrivateJwk(value: string): boolean {
  try {
    const jwk: { d?: unknown; kid?: unknown } = JSON.parse(atob(value));
    return typeof jwk.d === "string" && typeof jwk.kid === "string";
  } catch {
    return false;
  }
}

function run(command: string, args: string[], cwd = "."): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/**
 * Runs netlify-cli. From the repo root it sees the workspace packages (packages/*) and stops to ask which one to
 * use, which fails without a terminal. It skips that question when --cwd names a directory it wasn't started in,
 * so it starts in scripts/ and --cwd points it back at the app, as scripts/release.ts does for deploys.
 */
function netlify(args: string[]): string {
  return run("netlify", [...args, "--site", NETLIFY_SITE, "--cwd", process.cwd()], "scripts");
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

// A key that lost a character on its way into 1Password fails every
// Convex call; catch it here, before Netlify gets anything.
const jwtKey = values.SLOPPER_JWT_PRIVATE_KEY;
if (jwtKey && !isPrivateJwk(jwtKey)) {
  console.error("SLOPPER_JWT_PRIVATE_KEY isn't a base64 private JWK. Copy it into 1Password again.");
  process.exit(1);
}

const wanted: string[] = [];
for (const [name, { hasDefault }] of declared) {
  const value = values[name];
  // Optional secrets that aren't in the item yet (X, the content check).
  if (!value) {
    console.log(`skip ${name}: no value`);
    continue;
  }
  const secret = hasDefault ? [] : ["--secret"];
  netlify(["env:set", name, value, "--context", "production", ...secret, "--force"]);
  console.log(`set ${name}${secret.length ? " (secret)" : ""}`);
  wanted.push(name);
}

const onNetlify = new Set(Object.keys(JSON.parse(netlify(["env:list", "--json", "--context", "production"]))));
const missing = wanted.filter((name) => !onNetlify.has(name));
if (missing.length > 0) {
  console.error(`Netlify doesn't have ${missing.join(", ")} after setting them.`);
  process.exit(1);
}
console.log(`Set ${wanted.length} variables on Netlify. Deploy again for functions to see them.`);
