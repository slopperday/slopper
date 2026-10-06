import { LINK_KINDS, type Platform, type SlopLink } from "./model";

/** Formatting shared by cards, pages and posts. */

const PLATFORM_LABELS: Record<Platform, string> = {
  web: "Web",
  ios: "iOS",
  android: "Android",
  code: "Code",
  other: "Link",
};

export interface PlatformBadge {
  platform: Platform;
  label: string;
  beta: boolean;
}

/** One badge per platform; a platform is "beta" if it has no released link. */
export function platformBadges(links: readonly SlopLink[]): PlatformBadge[] {
  const byPlatform = new Map<Platform, boolean>();
  for (const link of links) {
    const info = LINK_KINDS[link.kind];
    const isBeta = byPlatform.get(info.platform) ?? true;
    byPlatform.set(info.platform, isBeta && info.beta);
  }
  return [...byPlatform].map(([platform, beta]) => ({
    platform,
    label: PLATFORM_LABELS[platform],
    beta,
  }));
}

/** "Day 7/30", or null when the slop is outside a goal. */
export function dayLabel(slop: { goalDay: number | null; goalLength: number | null }): string | null {
  if (!slop.goalDay || !slop.goalLength) return null;
  return `Day ${slop.goalDay}/${slop.goalLength}`;
}

/** "#0042": the slop's place in Slopper's global sequence. */
export function numberLabel(slop: { number: number }): string {
  return `#${String(slop.number).padStart(4, "0")}`;
}

export function slopPath(username: string, slug: string): string {
  return `/@${username}/${slug}`;
}

/** Deterministic tilt so cards stick to the wall a little crooked. */
export function tiltFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 7) - 3) * 0.5;
}

/** "TiltMaze", or "TiltMaze · iOS app" for a later launch of the product. */
export function launchTitle(slop: { name: string; launchLabel: string | null }): string {
  return slop.launchLabel ? `${slop.name} · ${slop.launchLabel}` : slop.name;
}
