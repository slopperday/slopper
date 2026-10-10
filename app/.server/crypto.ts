import { decodeBase64Url, encodeBase64Url } from "./encoding";
import { config } from "./config";

/**
 * AES-GCM sealing for third-party tokens stored in KV. The key is derived
 * from `SLOPPER_SECRET_KEY`; rotating it disconnects every social account.
 */

const VERSION = "v1";
const DEV_SECRET = "slopper-local-development-only";
let keyPromise: Promise<CryptoKey> | null = null;

export class MissingSecretKeyError extends Error {
  constructor() {
    super(
      "SLOPPER_SECRET_KEY is not set. Generate one with `openssl rand -base64 32` and add it to the app's environment.",
    );
    this.name = "MissingSecretKeyError";
  }
}

function secret(): string {
  if (config.secretKey) return config.secretKey;
  // A production build never falls back to the development key.
  if (import.meta.env.PROD) throw new MissingSecretKeyError();
  return DEV_SECRET;
}

async function deriveKey(material: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function key(): Promise<CryptoKey> {
  keyPromise ??= deriveKey(secret());
  return keyPromise;
}

export async function seal(plaintext: string, cryptoKey?: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey ?? (await key()),
    new TextEncoder().encode(plaintext),
  );
  return [VERSION, encodeBase64Url(iv), encodeBase64Url(new Uint8Array(ciphertext))].join(".");
}

export async function unseal(sealed: string, cryptoKey?: CryptoKey): Promise<string> {
  const [version, iv, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext) {
    throw new Error("Unrecognised sealed value");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(iv) },
    cryptoKey ?? (await key()),
    decodeBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

/** Exposed for tests that need an isolated key. */
export { deriveKey };
