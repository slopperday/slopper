import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { importJWK, type JWK, SignJWT } from "jose";
import { config } from "./config";

/**
 * The app server's line to Convex. It signs short-lived ES256 JWTs that
 * Convex trusts (see `convex/auth.config.ts`): `sub: "server"` for its own
 * calls, and `sub: <user id>` for browsers subscribing to live queries.
 */

const SERVER_SUBJECT = "server";
const TOKEN_TTL_SECONDS = 3600;

export class MissingConvexConfigError extends Error {
  constructor(name: string) {
    super(`${name} is not set. Run \`node scripts/convex-keys.ts\` (see README).`);
    this.name = "MissingConvexConfigError";
  }
}

let keyPromise: Promise<{ key: CryptoKey | Uint8Array; kid: string }> | null = null;

function signingKey() {
  keyPromise ??= (async () => {
    if (!config.jwtPrivateKey) throw new MissingConvexConfigError("SLOPPER_JWT_PRIVATE_KEY");
    const jwk = JSON.parse(atob(config.jwtPrivateKey)) as JWK;
    return { key: await importJWK(jwk, "ES256"), kid: jwk.kid ?? "slopper" };
  })();
  return keyPromise;
}

/** A JWT Convex accepts for `subject` ("server" or a users id). */
export async function mintToken(subject: string): Promise<string> {
  const { key, kid } = await signingKey();
  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setSubject(subject)
    .setIssuer(config.jwtIssuer)
    .setAudience("convex")
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

let serverClient: { client: ConvexHttpClient; expires: number } | null = null;

async function client(): Promise<ConvexHttpClient> {
  if (!config.convexUrl) throw new MissingConvexConfigError("CONVEX_URL");
  // Re-sign a few minutes before the token runs out.
  if (!serverClient || serverClient.expires < Date.now() + 300_000) {
    const instance = new ConvexHttpClient(config.convexUrl);
    instance.setAuth(await mintToken(SERVER_SUBJECT));
    serverClient = { client: instance, expires: Date.now() + TOKEN_TTL_SECONDS * 1000 };
  }
  return serverClient.client;
}

/** Calls Convex as the app server. */
export const convex = {
  async query<Query extends FunctionReference<"query">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): Promise<FunctionReturnType<Query>> {
    return await (await client()).query(query, ...args);
  },
  async mutation<Mutation extends FunctionReference<"mutation">>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>> {
    return await (await client()).mutation(mutation, ...args);
  },
  async action<Action extends FunctionReference<"action">>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<FunctionReturnType<Action>> {
    return await (await client()).action(action, ...args);
  },
};

/** Something that calls Convex as the app server: `convex`, or a test's stand-in. */
export type ConvexCaller = Pick<typeof convex, "query" | "mutation">;

/** The message from a business-rule error thrown in Convex, if that's what this is. */
export function convexMessage(error: unknown): string | null {
  if (error instanceof ConvexError) return typeof error.data === "string" ? error.data : "Something went wrong.";
  return null;
}

/** Runs a query as a signed-in person, for data only they may see. */
export async function queryAsUser<Query extends FunctionReference<"query">>(
  userId: string,
  query: Query,
  ...args: OptionalRestArgs<Query>
): Promise<FunctionReturnType<Query>> {
  if (!config.convexUrl) throw new MissingConvexConfigError("CONVEX_URL");
  const client = new ConvexHttpClient(config.convexUrl);
  client.setAuth(await mintToken(userId));
  return await client.query(query, ...args);
}
