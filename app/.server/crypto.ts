import { decodeBase64Url, encodeBase64Url } from "./encoding";
import { config } from "./config";

/**
 * AES-GCM sealing for third-party tokens stored in KV. The key is derived
 * from `SLOPPER_SECRET_KEY`; rotating it disconnects every social account.
 */

const VERSION = "v1";
const DEV_SECRET = "slopper-local-development-only";
let keysPromise: Promise<CryptoKey[]> | null = null;

export class MissingSecretKeyError extends Error {
  constructor() {
    super(
      "SLOPPER_SECRET_KEY is not set. Generate one with `openssl rand -base64 32` and add it to the app's environment.",
    );
    this.name = "MissingSecretKeyError";
  }
}

function secrets(): string[] {
  if (config.secretKey) {
    const list = config.secretKey
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  // A production build never falls back to the development key.
  if (import.meta.env.PROD) throw new MissingSecretKeyError();
  return [DEV_SECRET];
}

async function deriveKey(material: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function keys(): Promise<CryptoKey[]> {
  keysPromise ??= Promise.all(secrets().map((item) => deriveKey(item)));
  return keysPromise;
}

export async function seal(plaintext: string, cryptoKey?: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const activeKey = cryptoKey ?? (await keys())[0];
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    activeKey,
    new TextEncoder().encode(plaintext),
  );
  return [VERSION, encodeBase64Url(iv), encodeBase64Url(new Uint8Array(ciphertext))].join(".");
}

export async function unseal(sealed: string, cryptoKey?: CryptoKey | readonly CryptoKey[]): Promise<string> {
  const [version, iv, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext) {
    throw new Error("Unrecognised sealed value");
  }
  const candidates = cryptoKey ? (Array.isArray(cryptoKey) ? cryptoKey : [cryptoKey as CryptoKey]) : await keys();
  const decodedIv = decodeBase64Url(iv);
  const decodedCiphertext = decodeBase64Url(ciphertext);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodedIv }, candidate, decodedCiphertext);
      return new TextDecoder().decode(plaintext);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Could not unseal value");
}

/** Exposed for tests that need an isolated key. */
export { deriveKey };
