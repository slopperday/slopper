import { createHash } from "node:crypto";
import { resolve } from "node:path";
import process from "node:process";

/**
 * Port blocks for the e2e stack sit in 20000–29999: away from dev's 5173 and
 * 3210, and below every OS's ephemeral range (32768 and up on Linux, 49152 on
 * macOS), where outgoing connections take their ports.
 */
const FIRST_PORT = 20_000;
const BLOCK_SIZE = 10;
const BLOCKS = 1_000;

/**
 * The first port of this checkout's block. It comes from the checkout's
 * path, so every worktree gets its own and their suites (the pre-push hook
 * included) can run at the same time. Two paths can land on one block, one
 * time in a thousand; `E2E_PORT_BASE` moves a checkout by hand.
 */
export function portBase(checkout: string, override: string | undefined): number {
  if (override) {
    const base = Number(override);
    if (!Number.isInteger(base) || base < 1024 || base > 65535 - BLOCK_SIZE) {
      throw new Error(`E2E_PORT_BASE must be a port from 1024 to ${65535 - BLOCK_SIZE}, not “${override}”.`);
    }
    return base;
  }
  const slot = createHash("sha256").update(checkout).digest().readUInt16BE(0) % BLOCKS;
  return FIRST_PORT + slot * BLOCK_SIZE;
}

const base = portBase(resolve(import.meta.dirname, ".."), process.env.E2E_PORT_BASE);

/** Where the e2e stack listens: this checkout's block (`portBase`). */
export const PORTS = {
  app: base,
  convex: base + 1,
  convexSite: base + 2,
  check: base + 3,
  s3: base + 4,
} as const;

/** Written by `e2e/stack.ts`, read by the fixtures. */
export const STACK_FILE = ".e2e/stack.json";

/** A wallet the stack's fake Solana RPC knows: one USDC token account, paid $12.50 an hour ago. */
export const E2E_WALLET = "E2eWa11etE2eWa11etE2eWa11etE2eWa11etE2eWa1";

/** The admin the stack lists in ADMIN_IDENTITIES: how they sign in, and the username they get. */
export const E2E_ADMIN_IDENTITY = { provider: "e2e", providerId: "admin" } as const;
export const E2E_ADMIN = "e2e-admin";

export interface Stack {
  appUrl: string;
  convexUrl: string;
  /** The backend's HTTP actions, where browsers send analytics. */
  convexSiteUrl: string;
  checkUrl: string;
  /** The fake B2 bucket's server; `GET /__objects` lists what it holds. */
  s3Url: string;
  /** MEDIA_PUBLIC_URL: where the bucket's objects are served from. */
  mediaUrl: string;
  adminKey: string;
  issuer: string;
  privateKey: string;
}

/** One request the fake content check received. */
/** One email as the digest sends it to Resend's batch API. */
export interface FakeEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export interface FakeCheckRequest {
  model: string;
  text: string;
  images: number;
  videos: number;
  /** PDFs (publications), read as text by OpenRouter's parser. */
  files: number;
  /** SHA-256 of each image's bytes, to match against what the bucket stored. */
  imageHashes: string[];
  /** Null when a marker made the call fail. */
  verdict: "ok" | "mature" | "blocked" | null;
}
