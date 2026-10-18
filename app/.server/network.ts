import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guards for requests the server makes to addresses people typed: a maker's
 * website for an AI draft, a self-hosted PostHog. They must never reach the
 * server's own network.
 */

/** Private, loopback, link-local and multicast addresses. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(mappedIpv4(lower.slice(7)));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
  }
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** The IPv4 inside an IPv4-mapped IPv6 address, written dotted ("7.7.7.7") or in hex ("7f00:1"). */
function mappedIpv4(tail: string): string {
  if (tail.includes(".")) return tail;
  const [high = 0, low = 0] = tail.split(":").map((part) => Number.parseInt(part || "0", 16));
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/** A host that's obviously local, before any lookup: localhost names and private address literals. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  return isIP(host) !== 0 && isPrivateAddress(host);
}

/** True when every address the host resolves to is public. */
export async function resolvesPublicly(hostname: string): Promise<boolean> {
  if (isLocalHostname(hostname)) return false;
  const addresses = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true });
  return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
}
