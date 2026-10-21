import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { addDays } from "~/lib/dates";
import {
  DEFAULT_SIGNUP_EVENT,
  INTEGRATION_PROVIDERS,
  INTEGRATIONS,
  type IntegrationProvider,
  POSTHOG_REGIONS,
  TRACTION_DAYS,
} from "~/lib/integrations";
import { config } from "../config";
import { convex } from "../convex";
import { seal, unseal } from "../crypto";
import { isLocalHostname } from "../network";
import { publicFetch } from "../preview";
import { GA_PROPERTY_ID, syncGoogleAnalytics } from "./google";
import { EVENT_NAME, POSTHOG_KEY, POSTHOG_PROJECT_ID, syncPostHog } from "./posthog";
import { SOLANA_ADDRESS, syncSolana } from "./solana";
import { SourceError, type SyncInput, type SyncResult } from "./source";
import { STRIPE_KEY, syncStripe } from "./stripe";

/**
 * Every source is read through the SSRF-pinned transport (../preview): an
 * address a person typed — a self-hosted PostHog, a Solana RPC — can't be
 * private, and can't rebind to private between check and connection. Fixed
 * cloud APIs ride the same road for one rule everywhere.
 */
const pinnedFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const body = init?.body;
  return await publicFetch(url, {
    method: init?.method,
    headers: init ? Object.fromEntries(new Headers(init.headers)) : undefined,
    body: typeof body === "string" ? body : undefined,
    timeoutMs: 20_000,
    // The e2e stack's fake Solana RPC answers on 127.0.0.1; production never
    // sets this, and even with it only loopback opens up (preview.ts).
    loopback: process.env.SLOPPER_ALLOW_LOCAL_FETCH === "1",
    ...(init?.signal ? { signal: init.signal } : {}),
  });
};

/**
 * Connecting sources and keeping their numbers fresh. Syncs run here because
 * only the app server can unseal API keys; Convex stores what they find and
 * pages read it live.
 */

/** Sources this server can offer: Google Analytics needs Slopper's service account. */
export function availableProviders(): IntegrationProvider[] {
  return INTEGRATION_PROVIDERS.filter((provider) => provider !== "ga4" || config.googleAnalytics !== null);
}

/** Which days a sync recounts: the whole window the first time, then the last few (late data lands there). */
function sinceFor(syncedAt: number | null, today: string): string {
  return addDays(today, syncedAt === null ? -(TRACTION_DAYS - 1) : -2);
}

async function run(provider: IntegrationProvider, input: SyncInput): Promise<SyncResult> {
  switch (provider) {
    case "stripe":
      return await syncStripe(input);
    case "solana":
      return await syncSolana(input, config.solanaRpcUrl);
    case "posthog":
      return await syncPostHog(input);
    case "ga4":
      if (!config.googleAnalytics) throw new SourceError("Google Analytics isn't set up on this server.");
      return await syncGoogleAnalytics(input, config.googleAnalytics);
  }
}

/** Runs one sync, turning any failure into a message for the owner. */
async function attempt(
  provider: IntegrationProvider,
  input: SyncInput,
): Promise<{ ok: true; result: SyncResult } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await run(provider, input) };
  } catch (error) {
    if (error instanceof SourceError) return { ok: false, error: error.message };
    console.error(`${provider} sync failed`, error);
    return { ok: false, error: `Couldn't reach ${INTEGRATIONS[provider].label} just now. It'll try again soon.` };
  }
}

export interface ConnectRequest {
  settings: Record<string, string>;
  secret: string | null;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Reads a connect form. Formats are checked here; whether the source accepts them, by the first sync. */
export function parseConnect(
  provider: IntegrationProvider,
  form: FormData,
): { ok: true; value: ConnectRequest } | { ok: false; error: string } {
  const signupEvent = field(form, "signupEvent") || DEFAULT_SIGNUP_EVENT;
  switch (provider) {
    case "stripe": {
      const key = field(form, "key");
      if (key.startsWith("sk_")) return { ok: false, error: "That's a secret key. Make a restricted key instead." };
      if (!STRIPE_KEY.test(key)) return { ok: false, error: "Paste a restricted key: it starts with rk_live_." };
      return { ok: true, value: { settings: { keyEnding: key.slice(-4) }, secret: key } };
    }
    case "solana": {
      const wallet = field(form, "wallet");
      if (!SOLANA_ADDRESS.test(wallet)) return { ok: false, error: "That isn't a Solana wallet address." };
      return { ok: true, value: { settings: { wallet }, secret: null } };
    }
    case "ga4": {
      const propertyId = field(form, "propertyId");
      if (!GA_PROPERTY_ID.test(propertyId)) {
        return { ok: false, error: "The property id is the number in Admin › Property details, not the G- id." };
      }
      if (!EVENT_NAME.test(signupEvent)) return { ok: false, error: "That doesn't look like an event name." };
      return { ok: true, value: { settings: { propertyId, signupEvent }, secret: null } };
    }
    case "posthog": {
      const key = field(form, "key");
      const projectId = field(form, "projectId");
      const region = field(form, "region");
      const host = region === "us" || region === "eu" ? POSTHOG_REGIONS[region] : selfHostedOrigin(field(form, "host"));
      if (!POSTHOG_KEY.test(key)) return { ok: false, error: "Paste a personal API key: it starts with phx_." };
      if (!POSTHOG_PROJECT_ID.test(projectId)) return { ok: false, error: "The project id is a number." };
      if (!host) return { ok: false, error: "Self-hosted PostHog needs its https address." };
      if (!EVENT_NAME.test(signupEvent)) return { ok: false, error: "That doesn't look like an event name." };
      return { ok: true, value: { settings: { host, projectId, signupEvent }, secret: key } };
    }
  }
}

function selfHostedOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !isLocalHostname(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Connects a source: its first sync runs before anything is saved, so a key
 * that's refused is never stored, and the page has numbers straight away.
 */
export async function connectSource(
  userId: Id<"users">,
  slopId: Id<"slops">,
  provider: IntegrationProvider,
  request: ConnectRequest,
  visible: boolean,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const today = now.toISOString().slice(0, 10);
  const outcome = await attempt(provider, {
    settings: request.settings,
    secret: request.secret,
    cursor: null,
    since: sinceFor(null, today),
    today,
    fetcher: pinnedFetch,
  });
  if (!outcome.ok) return outcome;
  const integrationId = await convex.mutation(api.integrations.connect, {
    userId,
    slopId,
    provider,
    settings: request.settings,
    sealedSecret: request.secret ? await seal(request.secret) : null,
    public: visible,
  });
  await convex.mutation(api.integrations.record, { integrationId, outcome: { ok: true, ...outcome.result } });
  return { ok: true };
}

async function syncOne(row: Doc<"integrations">, today: string): Promise<void> {
  let secret: string | null = null;
  try {
    secret = row.sealedSecret ? await unseal(row.sealedSecret) : null;
  } catch (error) {
    console.error(`Couldn't unseal the ${row.provider} key`, error);
    await convex.mutation(api.integrations.record, {
      integrationId: row._id,
      outcome: { ok: false, error: "The saved key can't be read any more. Connect it again." },
    });
    return;
  }
  const outcome = await attempt(row.provider, {
    settings: row.settings,
    secret,
    cursor: row.cursor,
    since: sinceFor(row.syncedAt, today),
    today,
    fetcher: pinnedFetch,
  });
  await convex.mutation(api.integrations.record, {
    integrationId: row._id,
    outcome: outcome.ok ? { ok: true, ...outcome.result } : outcome,
  });
}

/**
 * Brings a product's sources up to date: the ones due a sync, or all of them
 * with `force`. Returns how many it synced. Page views call this, so it's
 * cheap when nothing is due: one Convex mutation.
 */
export async function syncProduct(productId: Id<"slops">, force = false, now = new Date()): Promise<number> {
  const due = await convex.mutation(api.integrations.claim, { productId, force });
  const today = now.toISOString().slice(0, 10);
  await Promise.all(due.map((row) => syncOne(row, today)));
  return due.length;
}
