import { exportJWK, generateKeyPair } from "jose";

/** What the app server and Convex each need to trust one another. */
export interface ServerKeys {
  /** Goes to the app server as `SLOPPER_JWT_PRIVATE_KEY`: a base64 JSON JWK. */
  privateKey: string;
  /** Goes to Convex as `SLOPPER_JWKS`: the public key set as a data URI. */
  jwks: string;
  kid: string;
}

/** A fresh ES256 key pair in the shapes `app/.server/convex.ts` and `convex/auth.config.ts` read. */
export async function generateServerKeys(): Promise<ServerKeys> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = `slopper-${new Date().toISOString().slice(0, 10)}`;
  const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "ES256" };
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  return {
    privateKey: Buffer.from(JSON.stringify(privateJwk)).toString("base64"),
    jwks: `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify({ keys: [publicJwk] })).toString("base64")}`,
    kid,
  };
}
