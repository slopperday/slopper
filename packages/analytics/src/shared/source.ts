/**
 * Where a visit came from: the referring site and the UTM tags of its first
 * page, sorted into channels the way web analytics tools group them.
 */

export type Channel = "direct" | "search" | "social" | "email" | "paid" | "referral" | "internal";

export interface TrafficSource {
  /** The referring page's host, without `www.`; null for direct visits. */
  referrerDomain: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  channel: Channel;
}

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave|qwant|kagi|startpage|naver|perplexity)\./;
const SOCIAL =
  /(^|\.)(t\.co|x\.com|twitter\.com|facebook\.com|fb\.com|instagram\.com|linkedin\.com|lnkd\.in|reddit\.com|news\.ycombinator\.com|bsky\.app|threads\.net|mastodon\.|youtube\.com|tiktok\.com|pinterest\.|producthunt\.com|discord\.com|t\.me|whatsapp\.com|indiehackers\.com)/;
const EMAIL = /(^|\.)(mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|mail\.proton\.me)$/;
const PAID_MEDIUM = /^(cpc|ppc|paid|paidsearch|paid_social|display|banner|cpm|ad|ads)$/i;
const EMAIL_MEDIUM = /^(e-?mail|newsletter)$/i;
const SOCIAL_MEDIUM = /^(social|social-network|social-media|sm|social_network)$/i;

/** The host of a URL without `www.`, or null when it isn't a URL. */
export function hostOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const host = new URL(url).hostname.toLowerCase();
  return host.replace(/^www\./, "") || null;
}

function utm(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed.slice(0, 200) : null;
}

/**
 * Sorts a visit into a channel. UTM tags win over the referrer, since they
 * say what the link was for; a referrer from the site itself is `internal`
 * (a new session started on a page someone had open).
 */
export function trafficSource(input: {
  referrer: string | null;
  ownHost: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}): TrafficSource {
  const referrerDomain = input.referrer ? hostOf(input.referrer) : null;
  const source = utm(input.utmSource);
  const medium = utm(input.utmMedium);
  const own = input.ownHost?.replace(/^www\./, "").toLowerCase() ?? null;
  let channel: Channel;
  if (medium && PAID_MEDIUM.test(medium)) channel = "paid";
  else if (medium && EMAIL_MEDIUM.test(medium)) channel = "email";
  else if (medium && SOCIAL_MEDIUM.test(medium)) channel = "social";
  else if (referrerDomain && own && referrerDomain === own) channel = "internal";
  else if (referrerDomain && EMAIL.test(referrerDomain)) channel = "email";
  else if (referrerDomain && SEARCH.test(referrerDomain)) channel = "search";
  else if (referrerDomain && SOCIAL.test(referrerDomain)) channel = "social";
  else if (source && SOCIAL.test(`${source}.`)) channel = "social";
  else if (referrerDomain || source) channel = "referral";
  else channel = "direct";
  return { referrerDomain, utmSource: source, utmMedium: medium, utmCampaign: utm(input.utmCampaign), channel };
}
