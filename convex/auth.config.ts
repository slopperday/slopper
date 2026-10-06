import type { AuthConfig } from "convex/server";

/**
 * Slopper's app server signs short-lived ES256 JWTs: `sub: "server"` for
 * itself, `sub: <users id>` for a signed-in person's browser. The public
 * key is embedded as a data URI, so Convex never calls back to the app.
 * Set both with `vp run convex:keys` (see scripts/convex-keys.ts).
 */
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "convex",
      issuer: process.env.SLOPPER_JWT_ISSUER ?? "https://slopper.day",
      jwks: process.env.SLOPPER_JWKS ?? "",
      algorithm: "ES256",
    },
  ],
} satisfies AuthConfig;
