import type { Route } from "./+types/auth.callback";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { grantListedAdmin, startSession, viewerContext } from "~/.server/session";
import { config } from "~/.server/config";
import { convex } from "~/.server/convex";
import type { OAuthClientCredentials } from "~/.server/config";
import {
  clientCredentials,
  exchangeCode,
  INTENT_HOME,
  OAuthError,
  type OAuthIntent,
  type PendingAuthorization,
  takePendingAuthorization,
  type TokenSet,
} from "~/.server/auth/oauth";
import { avatarExpires, fetchIdentity } from "~/.server/auth/identity";
import { secondFactorGate } from "~/.server/auth/twoFactor";
import { copyAvatar } from "~/.server/media";
import { fetchLinkedInPages, fetchLinkedInProfile, fetchXProfile, sealCredentials } from "~/.server/social/adapters";
import { connectExtraNetwork } from "~/.server/social/connect";
import { clearCookie, notFound, OAUTH_COOKIE, readCookie, redirectWithFlash, TZ_COOKIE } from "~/.server/http";
import {
  AUTH_LABELS,
  type AuthProviderId,
  type Flash,
  isAuthProvider,
  isOAuthProvider,
  OAUTH_LABELS,
  type OAuthProviderId,
} from "~/lib/model";

const EXPIRED: Flash = { tone: "error", message: "That sign-in link expired. Try again." };

function cancelled(intent: OAuthIntent, label: string): Flash {
  const message = {
    login: `${label} sign-in was cancelled.`,
    link: `Linking ${label} was cancelled.`,
    connect: `Connecting ${label} was cancelled.`,
  }[intent];
  return { tone: "info", message };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const provider = params.provider;
  if (!isAuthProvider(provider)) notFound();
  const search = new URL(request.url).searchParams;
  const state = search.get("state") ?? "";
  // The state must match the cookie set on this browser when the flow began.
  const pending = state && readCookie(request, OAUTH_COOKIE) === state ? await takePendingAuthorization(state) : null;
  const response = await finish(request, provider, search, pending, context.get(viewerContext).user?._id);
  clearCookie(response.headers, OAUTH_COOKIE);
  return response;
}

async function finish(
  request: Request,
  provider: AuthProviderId,
  search: URLSearchParams,
  pending: PendingAuthorization | null,
  currentUserId: Id<"users"> | undefined,
): Promise<Response> {
  const label = AUTH_LABELS[provider];
  const home = pending ? INTENT_HOME[pending.intent] : "/login";
  if (search.has("error")) return redirectWithFlash(home, cancelled(pending?.intent ?? "login", label));

  const code = search.get("code");
  const client = clientCredentials(provider);
  if (!code || !pending || pending.provider !== provider || !client) return redirectWithFlash(home, EXPIRED);

  try {
    const tokens = await exchangeCode(provider, client, code, pending.codeVerifier);
    if (pending.intent === "connect") return await completeConnect(provider, client, tokens, pending, currentUserId);
    // Connect-only providers never get this far with another intent (`parseIntent`).
    if (!isOAuthProvider(provider)) return redirectWithFlash(home, EXPIRED);
    return pending.intent === "login"
      ? await completeLogin(request, provider, client, tokens, pending)
      : await completeLink(provider, client, tokens, pending, currentUserId);
  } catch (error) {
    console.error(`OAuth ${pending.intent} failed for ${provider}`, error);
    return redirectWithFlash(home, {
      tone: "error",
      message: `Couldn't finish with ${label}. Try again.`,
    });
  }
}

async function completeLogin(
  request: Request,
  provider: OAuthProviderId,
  client: OAuthClientCredentials,
  tokens: TokenSet,
  pending: PendingAuthorization,
): Promise<Response> {
  const profile = await fetchIdentity(provider, tokens.accessToken, client);
  const picture = avatarExpires(provider) ? profile.avatarUrl : null;
  const { userId, created } = await convex.mutation(api.users.upsertFromIdentity, {
    ...profile,
    avatarUrl: picture ? null : profile.avatarUrl,
    timeZone: decodeURIComponent(readCookie(request, TZ_COOKIE) ?? "UTC"),
  });
  if (created && picture) await copyAvatar(userId, picture);
  await grantListedAdmin(profile);
  // Someone with an authenticator app or a passkey proves it's them again before the session starts.
  const gate = await secondFactorGate(userId, pending.returnTo);
  if (gate) return gate;
  const user = await convex.query(api.users.get, { userId });
  const response = created
    ? redirectWithFlash("/goal", {
        tone: "success",
        message: `Welcome, @${user?.username ?? "slopper"}. Set a goal and start slopping.`,
      })
    : redirectWithFlash(pending.returnTo);
  await startSession(userId, response.headers, { verified: true, userAgent: request.headers.get("user-agent") });
  return response;
}

async function completeLink(
  provider: OAuthProviderId,
  client: OAuthClientCredentials,
  tokens: TokenSet,
  pending: PendingAuthorization,
  currentUserId: Id<"users"> | undefined,
): Promise<Response> {
  // The browser that finishes the flow must belong to whoever started it.
  if (!pending.userId || pending.userId !== currentUserId) {
    return redirectWithFlash("/login", { tone: "error", message: "Sign in again to link accounts." });
  }
  const label = OAUTH_LABELS[provider];
  const profile = await fetchIdentity(provider, tokens.accessToken, client);
  const result = await convex.mutation(api.users.linkIdentity, {
    userId: pending.userId,
    provider,
    providerId: profile.providerId,
    email: profile.email,
  });
  if (result.ok) {
    await grantListedAdmin({ provider, providerId: profile.providerId });
    return redirectWithFlash(
      pending.returnTo,
      result.alreadyLinked
        ? { tone: "info", message: `${label} was already linked.` }
        : { tone: "success", message: `Linked ${label}. You can sign in with it now.` },
    );
  }
  return redirectWithFlash(pending.returnTo, {
    tone: "error",
    message:
      result.reason === "other_account"
        ? `That ${label} account already signs in to a different Slopper account. Sign in with it and unlink it there first.`
        : `A different ${label} account is already linked. Unlink it first.`,
  });
}

async function completeConnect(
  provider: AuthProviderId,
  client: OAuthClientCredentials,
  tokens: TokenSet,
  pending: PendingAuthorization,
  currentUserId: Id<"users"> | undefined,
): Promise<Response> {
  // The browser that finishes the flow must belong to whoever started it.
  if (!pending.userId || pending.userId !== currentUserId) {
    return redirectWithFlash("/login", { tone: "error", message: "Sign in again to connect accounts." });
  }

  if (provider === "x") {
    const profile = await fetchXProfile(tokens.accessToken);
    const account = await convex.mutation(api.accounts.connect, {
      userId: pending.userId,
      provider: "x",
      remoteId: profile.id,
      handle: profile.username,
      displayName: profile.name,
      avatarUrl: profile.profile_image_url ?? null,
      sealedCredentials: await sealCredentials({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      }),
      expiresAt: null,
    });
    return redirectWithFlash("/settings/autopost", { tone: "success", message: `Connected @${account.handle} on X.` });
  }

  if (provider !== "linkedin") {
    const flash = await connectExtraNetwork(provider, client, tokens, pending.userId);
    if (!flash) throw new OAuthError(`${AUTH_LABELS[provider]} can't connect for auto-posting.`);
    return redirectWithFlash("/settings/autopost", flash);
  }
  const profile = await fetchLinkedInProfile(tokens.accessToken);
  const account = await convex.mutation(api.accounts.connect, {
    userId: pending.userId,
    provider: "linkedin",
    remoteId: profile.sub,
    handle: profile.name ?? profile.given_name ?? "LinkedIn member",
    displayName: profile.name ?? "LinkedIn member",
    avatarUrl: profile.picture ?? null,
    sealedCredentials: await sealCredentials({
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      personUrn: `urn:li:person:${profile.sub}`,
    }),
    expiresAt: tokens.expiresAt,
  });
  // With Company Pages turned on, each Page you administer becomes its own account: the brand posts as itself.
  let pages: { urn: string; name: string }[] = [];
  if (config.linkedinPages) {
    pages = await fetchLinkedInPages(tokens.accessToken).catch((error: unknown) => {
      console.warn("Listing LinkedIn Pages failed", error);
      return [];
    });
    for (const page of pages) {
      await convex.mutation(api.accounts.connect, {
        userId: pending.userId,
        provider: "linkedin",
        remoteId: page.urn,
        handle: page.name,
        displayName: page.name,
        avatarUrl: null,
        sealedCredentials: await sealCredentials({
          accessToken: tokens.accessToken,
          expiresAt: tokens.expiresAt,
          personUrn: page.urn,
        }),
        expiresAt: tokens.expiresAt,
        initialMode: "off",
        brand: page.name,
      });
    }
  }
  return redirectWithFlash("/settings/autopost", {
    tone: "success",
    message: pages.length
      ? `Connected ${account.displayName} and ${pages.length === 1 ? "1 Company Page" : `${pages.length} Company Pages`} on LinkedIn.`
      : `Connected ${account.displayName} on LinkedIn.`,
  });
}
