import { redirect } from "react-router";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { renderSVG } from "uqr";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { config } from "../config";
import { convex } from "../convex";
import { seal, unseal } from "../crypto";
import { decodeBase64Url, encodeBase64, encodeBase64Url, hashToken, randomToken } from "../encoding";
import { clearCookie, readCookie, SESSION_COOKIE, setCookie, TWO_FACTOR_COOKIE } from "../http";
import { startSession, type User, type Viewer } from "../session";
import { safeReturnTo } from "./oauth";
import { matchTotp, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl } from "./totp";

/**
 * Two-step sign-in. Slopper has no passwords: people sign in with GitHub,
 * Google, X, LinkedIn or Facebook. Anyone who adds an authenticator app or a
 * passkey must use it too, every time, before a session starts. Sensitive
 * actions (making API tokens, connecting social accounts, changing these
 * settings) ask again when the session last proved it was its owner more
 * than 15 minutes ago.
 *
 * The browser holds a step's token in a short cookie; Convex holds its hash,
 * counts the tries, and makes every code and step usable once.
 */

const CHALLENGE_MS = 10 * 60_000;
export const STEP_UP_MS = 15 * 60_000;
export const VERIFY_PATH = "/login/verify";

export type Method = "authenticator app" | "passkey" | "recovery code";

function rp() {
  return { rpID: config.appUrl.hostname, origin: config.appUrl.origin, rpName: "Slopper" };
}

export async function secondFactorRequired(userId: Id<"users">): Promise<boolean> {
  return await convex.query(api.security.required, { userId });
}

async function newChallenge(
  userId: Id<"users">,
  kind: "login" | "stepup",
  returnTo: string,
  headers: Headers,
): Promise<void> {
  const token = randomToken();
  await convex.mutation(api.security.createChallenge, {
    tokenHash: await hashToken(token),
    kind,
    userId,
    returnTo: safeReturnTo(returnTo),
    ttlMs: CHALLENGE_MS,
  });
  setCookie(headers, TWO_FACTOR_COOKIE, token, CHALLENGE_MS / 1000);
}

/**
 * After OAuth: when the person has a second factor, the session waits for it
 * (/login/verify). Returns null when they don't, and a session can start now.
 */
export async function secondFactorGate(userId: Id<"users">, returnTo: string): Promise<Response | null> {
  if (!(await secondFactorRequired(userId))) return null;
  const headers = new Headers({ location: VERIFY_PATH });
  await newChallenge(userId, "login", returnTo, headers);
  return new Response(null, { status: 302, headers });
}

/**
 * Before a sensitive action: when the person has a second factor and this
 * session hasn't proved it's theirs in the last 15 minutes, sends them to
 * confirm it, coming back to `returnTo` (this page, by default). People
 * without a second factor have nothing to confirm with, so it lets them through.
 */
/** Whether this session proved it's its owner in the last 15 minutes (or the person has nothing to prove it with). */
export async function recentlyVerified(viewer: Viewer, request: Request): Promise<boolean> {
  const user = viewer.user;
  if (!user) return false;
  if (!(await secondFactorRequired(user._id))) return true;
  const token = readCookie(request, SESSION_COOKIE);
  const verifiedAt = token
    ? await convex.query(api.security.sessionVerifiedAt, { tokenHash: await hashToken(token) })
    : null;
  return verifiedAt !== null && Date.now() - verifiedAt < STEP_UP_MS;
}

export async function requireRecentAuth(viewer: Viewer, request: Request, returnTo?: string): Promise<void> {
  const user = viewer.user;
  if (!user || (await recentlyVerified(viewer, request))) return;
  const url = new URL(request.url);
  const back = returnTo ?? (request.method === "GET" ? url.pathname + url.search : url.pathname);
  const headers = new Headers({ location: `${VERIFY_PATH}?confirm=1` });
  await newChallenge(user._id, "stepup", back, headers);
  throw new Response(null, { status: 302, headers });
}

export interface PendingStep {
  tokenHash: string;
  kind: "login" | "stepup" | "register";
  userId: Id<"users">;
  challenge: string | null;
  returnTo: string;
}

/** The step this browser is in the middle of, or null. A step-up belongs to the signed-in person only. */
export async function pendingStep(request: Request, viewer: Viewer): Promise<PendingStep | null> {
  const token = readCookie(request, TWO_FACTOR_COOKIE);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const step = await convex.query(api.security.challenge, { tokenHash });
  if (!step || step.kind === "register") return null;
  if (step.kind === "stepup" && step.userId !== viewer.user?._id) return null;
  return { tokenHash, ...step };
}

/** The step worked: start the session (signing in) or mark this one verified (confirming), then go back. */
export async function finishStep(request: Request, step: PendingStep, method: Method): Promise<Response> {
  await convex.mutation(api.security.finishChallenge, { tokenHash: step.tokenHash });
  const response = redirect(step.returnTo);
  clearCookie(response.headers, TWO_FACTOR_COOKIE);
  if (step.kind === "login") {
    await startSession(step.userId, response.headers, { verified: true, userAgent: request.headers.get("user-agent") });
    await convex.mutation(api.security.logEvent, {
      userId: step.userId,
      kind: "signed-in",
      detail: `Signed in with ${method}`,
    });
  } else {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) await convex.mutation(api.security.markVerified, { tokenHash: await hashToken(token) });
  }
  return response;
}

/** Calls a step off; signing in starts over. */
export async function cancelStep(request: Request, step: PendingStep | null): Promise<Headers> {
  if (step) await convex.mutation(api.security.finishChallenge, { tokenHash: step.tokenHash });
  const headers = new Headers();
  clearCookie(headers, TWO_FACTOR_COOKIE);
  return headers;
}

export type CodeResult = { ok: true; method: Method } | { ok: false; error: string };

/** Checks a code typed at a step: six digits from the app, or a recovery code. */
export async function checkCode(step: PendingStep, typed: string): Promise<CodeResult> {
  const allowed = await convex.mutation(api.security.attempt, { tokenHash: step.tokenHash });
  if (!allowed.ok) {
    return {
      ok: false,
      error:
        allowed.reason === "slow"
          ? "Too many tries. Wait 15 minutes, then try again."
          : "That took too long or too many tries. Sign in again.",
    };
  }
  const code = typed.trim();
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const totp = await convex.query(api.security.totpSecret, { userId: step.userId });
    if (totp?.confirmed) {
      const matched = matchTotp(await unseal(totp.sealedSecret), code);
      if (matched !== null) {
        if (totp.lastStep !== null && matched <= totp.lastStep) {
          return { ok: false, error: "That code was already used. Wait a few seconds for the next one in your app." };
        }
        if (await convex.mutation(api.security.useTotpStep, { userId: step.userId, step: matched })) {
          return { ok: true, method: "authenticator app" };
        }
        return { ok: false, error: "That code was already used. Wait a few seconds for the next one in your app." };
      }
    }
    return { ok: false, error: "That code didn't match. Use the newest one from your app." };
  }
  const hash = await hashToken(normalizeRecoveryCode(code));
  if (await convex.mutation(api.security.useRecoveryCode, { userId: step.userId, hash })) {
    return { ok: true, method: "recovery code" };
  }
  return { ok: false, error: "That isn't a code we know. Recovery codes work once each." };
}

// ---------------------------------------------------------------------------
// Passkeys at a step

export async function passkeyOptionsForStep(step: PendingStep) {
  const keys = await convex.query(api.security.passkeysFor, { userId: step.userId });
  const options = await generateAuthenticationOptions({
    rpID: rp().rpID,
    userVerification: "preferred",
    allowCredentials: keys.map((key) => ({
      id: key.credentialId,
      transports: key.transports as AuthenticatorTransport[],
    })),
  });
  await convex.mutation(api.security.setWebAuthnChallenge, { tokenHash: step.tokenHash, challenge: options.challenge });
  return options;
}

export async function checkPasskey(step: PendingStep, response: AuthenticationResponseJSON): Promise<CodeResult> {
  const allowed = await convex.mutation(api.security.attempt, { tokenHash: step.tokenHash });
  if (!allowed.ok) return { ok: false, error: "That took too long or too many tries. Sign in again." };
  const fresh = await convex.query(api.security.challenge, { tokenHash: step.tokenHash });
  const key = await convex.query(api.security.passkeyByCredential, { credentialId: response.id });
  if (!fresh?.challenge || !key || key.userId !== step.userId) {
    return { ok: false, error: "That passkey isn't one of this account's." };
  }
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response,
      expectedChallenge: fresh.challenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().rpID,
      credential: {
        id: key.credentialId,
        publicKey: decodeBase64Url(key.publicKey),
        counter: key.counter,
        transports: key.transports as AuthenticatorTransport[],
      },
    });
    if (!verified) return { ok: false, error: "That passkey didn't check out." };
    if (
      !(await convex.mutation(api.security.usePasskey, { passkeyId: key._id, counter: authenticationInfo.newCounter }))
    ) {
      return { ok: false, error: "That passkey was refused. Use another, or a code." };
    }
    return { ok: true, method: "passkey" };
  } catch (error) {
    console.warn("A passkey sign-in failed", error);
    return { ok: false, error: "That passkey didn't check out." };
  }
}

// ---------------------------------------------------------------------------
// Setting things up

function setupView(secret: string, username: string) {
  const url = otpauthUrl(secret, `@${username}`);
  return {
    secret: secret.replace(/(.{4})/g, "$1 ").trim(),
    qr: `data:image/svg+xml;base64,${encodeBase64(new TextEncoder().encode(renderSVG(url, { border: 2 })))}`,
  };
}

/** Starts adding an authenticator app: a new secret, its QR code, and the secret to type by hand. */
export async function startTotpSetup(user: Pick<User, "_id" | "username">) {
  const secret = newTotpSecret();
  await convex.mutation(api.security.startTotp, { userId: user._id, sealedSecret: await seal(secret) });
  return setupView(secret, user.username);
}

/** The app being set up, shown again (after a wrong code, the same QR still works). */
export async function pendingTotpSetup(user: Pick<User, "_id" | "username">) {
  const totp = await convex.query(api.security.totpSecret, { userId: user._id });
  if (!totp || totp.confirmed) return null;
  return setupView(await unseal(totp.sealedSecret), user.username);
}

/**
 * Confirms the app with its first code. The first second factor comes with
 * recovery codes, shown once. This session counts as verified: it just proved it.
 */
export async function confirmTotpSetup(
  user: Pick<User, "_id">,
  typed: string,
  request: Request,
): Promise<{ ok: true; recoveryCodes: string[] | null } | { ok: false; error: string }> {
  const totp = await convex.query(api.security.totpSecret, { userId: user._id });
  if (!totp || totp.confirmed) return { ok: false, error: "Start again: add the app first." };
  const firstFactor = !(await secondFactorRequired(user._id));
  const step = matchTotp(await unseal(totp.sealedSecret), typed);
  if (step === null || !(await convex.mutation(api.security.useTotpStep, { userId: user._id, step }))) {
    return { ok: false, error: "That code didn't match. Check the phone's clock is right, and use the newest code." };
  }
  await markThisSessionVerified(request);
  return { ok: true, recoveryCodes: firstFactor ? await makeRecoveryCodes(user._id) : null };
}

export async function makeRecoveryCodes(userId: Id<"users">): Promise<string[]> {
  const codes = newRecoveryCodes();
  const hashes = await Promise.all(codes.map((code) => hashToken(normalizeRecoveryCode(code))));
  await convex.mutation(api.security.setRecoveryCodes, { userId, hashes });
  return codes;
}

export async function markThisSessionVerified(request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await convex.mutation(api.security.markVerified, { tokenHash: await hashToken(token) });
}

/** Options for adding a passkey, with a token the browser sends back with its answer. */
export async function passkeyRegistrationOptions(user: Pick<User, "_id" | "username" | "displayName">) {
  const keys = await convex.query(api.security.passkeysFor, { userId: user._id });
  const options = await generateRegistrationOptions({
    rpName: rp().rpName,
    rpID: rp().rpID,
    userName: `@${user.username}`,
    userDisplayName: user.displayName,
    userID: new TextEncoder().encode(user._id),
    attestationType: "none",
    excludeCredentials: keys.map((key) => ({
      id: key.credentialId,
      transports: key.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  const token = randomToken();
  const tokenHash = await hashToken(token);
  await convex.mutation(api.security.createChallenge, {
    tokenHash,
    kind: "register",
    userId: user._id,
    returnTo: "/settings/security",
    ttlMs: CHALLENGE_MS,
  });
  await convex.mutation(api.security.setWebAuthnChallenge, { tokenHash, challenge: options.challenge });
  return { options, token };
}

export async function addPasskey(
  user: Pick<User, "_id">,
  token: string,
  response: RegistrationResponseJSON,
  name: string,
  request: Request,
): Promise<{ ok: true; recoveryCodes: string[] | null } | { ok: false; error: string }> {
  const tokenHash = await hashToken(token);
  const step = await convex.query(api.security.challenge, { tokenHash });
  await convex.mutation(api.security.finishChallenge, { tokenHash });
  if (!step || step.kind !== "register" || step.userId !== user._id || !step.challenge) {
    return { ok: false, error: "That took too long. Try adding the passkey again." };
  }
  const firstFactor = !(await secondFactorRequired(user._id));
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response,
      expectedChallenge: step.challenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().rpID,
    });
    if (!verified || !registrationInfo) return { ok: false, error: "That passkey didn't check out." };
    const { credential } = registrationInfo;
    await convex.mutation(api.security.addPasskey, {
      userId: user._id,
      credentialId: credential.id,
      publicKey: encodeBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      name,
    });
  } catch (error) {
    console.warn("Adding a passkey failed", error);
    return { ok: false, error: "That passkey didn't check out. Try again." };
  }
  await markThisSessionVerified(request);
  return { ok: true, recoveryCodes: firstFactor ? await makeRecoveryCodes(user._id) : null };
}
