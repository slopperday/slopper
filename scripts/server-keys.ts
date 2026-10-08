import { exportJWK, generateKeyPair } from "jose";

/** What the app server and Convex each need to trust one another. */
export interface ServerKeys {
  /** Goes to the app server as `SLOPPER_JWT_PRIVATE_KEY`: a base64 JSON JWK. */
  privateKey: string;
  /** Goes to Convex as `SLOPPER_JWKS`: the public key set as a data URI. */
  jwks: string;
  kid: string;
}

/** Browser notifications' VAPID key pair (RFC 8292), both halves base64url. */
export interface VapidKeys {
  /** The uncompressed P-256 point browsers subscribe with: on the app server and Convex. */
  publicKey: string;
  /** The private scalar `d`: on Convex only, which signs every push. */
  privateKey: string;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!d) throw new Error("The VAPID private key didn't export.");
  const point = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: Buffer.from(point).toString("base64url"), privateKey: d };
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
