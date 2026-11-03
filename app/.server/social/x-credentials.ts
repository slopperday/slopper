import { createHmac, randomBytes } from "node:crypto";

/** Credentials for the maker's own X developer app and authorized account. */
export interface XOwnCredentials {
  kind: "own-app";
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** OAuth 1.0a signs URL/query parameters; JSON request bodies aren't signature parameters. */
export function xAuthorization(
  credentials: XOwnCredentials,
  method: string,
  address: string,
  nonce = randomBytes(24).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): string {
  const url = new URL(address);
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };
  const parameters = [...url.searchParams, ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const base = [method.toUpperCase(), `${url.origin}${url.pathname}`, parameters].map(encode).join("&");
  oauth.oauth_signature = createHmac(
    "sha1",
    `${encode(credentials.apiSecret)}&${encode(credentials.accessTokenSecret)}`,
  )
    .update(base)
    .digest("base64");
  return `OAuth ${Object.entries(oauth)
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(", ")}`;
}
