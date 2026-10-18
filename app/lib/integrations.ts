/**
 * Integrations: read-only connections that bring a slop's real traction onto
 * its page. Analytics sources count people and signups; payment sources
 * count revenue. Every number on the page says where it came from, so it's
 * verified rather than typed in (typed-in money stays in the ledger).
 *
 * Shared by the app and Convex. The clients live in app/.server/integrations.
 */

export const INTEGRATION_PROVIDERS = ["ga4", "posthog", "stripe", "solana"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export type IntegrationKind = "analytics" | "payments";

export interface IntegrationInfo {
  label: string;
  kind: IntegrationKind;
  /** What it counts, for the connect list. */
  counts: string;
}

export const INTEGRATIONS: Record<IntegrationProvider, IntegrationInfo> = {
  ga4: { label: "Google Analytics", kind: "analytics", counts: "People per day, signups, and who's on it now" },
  posthog: { label: "PostHog", kind: "analytics", counts: "People per day, signups, and who's on it now" },
  stripe: { label: "Stripe", kind: "payments", counts: "Revenue per day and monthly recurring revenue" },
  solana: { label: "Solana wallet", kind: "payments", counts: "USDC and USDT payments into the wallet" },
};

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

/** The event analytics sources count as a signup unless the maker names another. */
export const DEFAULT_SIGNUP_EVENT = "sign_up";

/** PostHog Cloud regions; anything else is a self-hosted origin. */
export const POSTHOG_REGIONS = { us: "https://us.posthog.com", eu: "https://eu.posthog.com" } as const;

/**
 * How long numbers stay fresh before a page view asks for new ones. "On it
 * now" covers the last 30 minutes, so five minutes old is still honest.
 */
export const SYNC_EVERY_MS = 5 * 60_000;

/** A sync that hasn't reported back in this long is taken to have died. */
export const SYNC_LOCK_MS = 60_000;

/** "On it now" older than this isn't shown: it would no longer be now. */
export const LIVE_FRESH_MS = 30 * 60_000;

/** Days of history the page shows. Sources backfill this much the first time. */
export const TRACTION_DAYS = 90;

/** One source's numbers for one day. Revenue is in minor units, by currency. */
export interface DayNumbers {
  date: string;
  people?: number;
  signups?: number;
  revenue?: Record<string, number>;
}

/** What a source reports about right now, alongside its days. */
export interface SourceSnapshot {
  /** Monthly recurring revenue in minor units, by currency. */
  mrr?: Record<string, number>;
  subscribers?: number;
  /** Different people in the last 30 days. Daily counts can't be added up for this: regulars count once. */
  people30?: number;
}

/** A connected source as the slop page shows it. Errors are for the owner only. */
export interface TractionSource {
  id: string;
  provider: IntegrationProvider;
  kind: IntegrationKind;
  /** The address it reads, when that's public by nature: a wallet. */
  label: string | null;
  public: boolean;
  status: "pending" | "ok" | "error";
  error: string | null;
  syncedAt: number | null;
  /** People on it in the last 30 minutes, and when that was counted. */
  live: { people: number; at: number } | null;
  snapshot: SourceSnapshot;
}

/** Everything the traction section draws: the sources, and one row per day per source. */
export interface Traction {
  sources: TractionSource[];
  days: (DayNumbers & { sourceId: string })[];
}

/** Adds revenue maps currency by currency. */
export function addRevenue(
  into: Record<string, number>,
  more: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  for (const [currency, amount] of Object.entries(more ?? {})) into[currency] = (into[currency] ?? 0) + amount;
  return into;
}
