import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time codes (RFC 6238), as authenticator apps make them:
 * HMAC-SHA1 over the 30-second step, six digits. Codes from one step either
 * side of now are accepted, for clocks a little out.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Not base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new shared secret: 20 random bytes, as base32 for the app. */
export function newTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

/** The address an authenticator app reads from the QR code. */
export function otpauthUrl(secret: string, account: string, issuer = "Slopper"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}

export function stepAt(now: number): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

/** The code for one step (RFC 4226 dynamic truncation). */
export function codeFor(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", Buffer.from(decodeBase32(secret)))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, "0");
}

/**
 * The step a typed code belongs to (now, or one step either side), or null.
 * Compared in constant time, so timing says nothing about how close a guess was.
 */
export function matchTotp(secret: string, typed: string, now = Date.now()): number | null {
  const code = typed.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    if (timingSafeEqual(Buffer.from(codeFor(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** Ten recovery codes like `k7mq-x2pd`, easy to read out and type. */
export function newRecoveryCodes(count = 10): string[] {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (byte) => letters[byte % letters.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

/** How a recovery code is compared: lower case, no spaces or dashes. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}
