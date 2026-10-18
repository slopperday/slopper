/**
 * Browser, operating system and device type from a User-Agent header. Only
 * major versions are kept: enough to group by, nothing that fingerprints.
 * The user agent itself is never stored.
 */

export type DeviceType = "desktop" | "mobile" | "tablet";

export interface DeviceInfo {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceType: DeviceType | null;
}

/** Order matters: Edge, Opera and Samsung Internet also say "Chrome", and in-app browsers say "Safari". */
const BROWSERS: readonly [name: string, pattern: RegExp][] = [
  ["Facebook", /\bFB(?:AN|AV)\/([\d.]+)/],
  ["Instagram", /\bInstagram ([\d.]+)/],
  ["Edge", /\bEdg(?:e|A|iOS)?\/([\d.]+)/],
  ["Opera", /\b(?:OPR|OPT)\/([\d.]+)/],
  ["Samsung Internet", /\bSamsungBrowser\/([\d.]+)/],
  ["Firefox", /\b(?:Firefox|FxiOS)\/([\d.]+)/],
  ["Chrome", /\b(?:Chrome|CriOS)\/([\d.]+)/],
  ["Safari", /\bVersion\/([\d.]+).*\bSafari\//],
];

const OSES: readonly [name: string, pattern: RegExp][] = [
  ["iOS", /\b(?:iPhone|iPad|iPod).*? OS (\d+)/],
  ["Android", /\bAndroid (\d+)/],
  ["Windows", /\bWindows NT (\d+(?:\.\d+)?)/],
  ["ChromeOS", /\bCrOS\b/],
  ["macOS", /\bMac OS X (\d+)/],
  ["Linux", /\bLinux\b/],
];

/** Windows NT versions people know by another name. Windows 11 still says NT 10.0. */
const WINDOWS_NAMES: Record<string, string> = {
  "10.0": "10",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
};

/**
 * Crawlers, link previews, monitors and scripts. Their visits aren't
 * people's, so the endpoint drops them before anything is stored.
 */
const BOT =
  /bot\b|bot\/|crawl|spider|slurp|headlesschrome|lighthouse|pagespeed|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|vkshare|bitly|preview|python|curl\/|wget\/|httpclient|okhttp|axios\/|node-fetch|go-http|java\/|phantomjs|puppeteer|playwright|datadog|pingdom|uptime/i;

export function isBot(userAgent: string): boolean {
  return userAgent.trim() === "" || BOT.test(userAgent);
}

function major(version: string | undefined): string | null {
  return version?.split(".")[0] || null;
}

export function parseUserAgent(userAgent: string): DeviceInfo {
  let browser: string | null = null;
  let browserVersion: string | null = null;
  for (const [name, pattern] of BROWSERS) {
    const match = pattern.exec(userAgent);
    if (match) {
      browser = name;
      browserVersion = major(match[1]);
      break;
    }
  }
  let os: string | null = null;
  let osVersion: string | null = null;
  for (const [name, pattern] of OSES) {
    const match = pattern.exec(userAgent);
    if (match) {
      os = name;
      osVersion = name === "Windows" ? (WINDOWS_NAMES[match[1] ?? ""] ?? match[1] ?? null) : major(match[1]);
      break;
    }
  }
  return { browser, browserVersion, os, osVersion, deviceType: deviceType(userAgent) };
}

function deviceType(userAgent: string): DeviceType | null {
  if (userAgent.trim() === "") return null;
  if (/\biPad\b|\bTablet\b|\bAndroid(?!.*\bMobile\b)/i.test(userAgent)) return "tablet";
  if (/\bMobi|\biPhone\b|\biPod\b/i.test(userAgent)) return "mobile";
  return "desktop";
}
