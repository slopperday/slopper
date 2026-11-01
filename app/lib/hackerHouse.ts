/** One event, in UTC; the end is exclusive so all of November 12 counts. */
export const HACKER_HOUSE = {
  tag: "Solana Hacker House",
  aliases: ["solana hackerhouse", "solana-hacker-house"],
  start: Date.parse("2026-11-01T00:00:00Z"),
  end: Date.parse("2026-11-13T00:00:00Z"),
} as const;

export const HACKER_HOUSE_MODES = [
  { id: "modest", label: "Modest", target: 3 },
  { id: "challenging", label: "Challenging", target: 6 },
  { id: "intense", label: "Intense", target: 10 },
] as const;

export function hackerHouseActive(now: number): boolean {
  return now >= HACKER_HOUSE.start && now < HACKER_HOUSE.end;
}

export function hackerHouseMode(value: unknown) {
  return HACKER_HOUSE_MODES.find((mode) => mode.id === value) ?? null;
}

/** Only original apps tagged for the event; callers also apply visibility and content-check rules. */
export function countsForHackerHouse(slop: {
  _id: string;
  productId?: string | null;
  _creationTime: number;
  madeWith: readonly string[];
}): boolean {
  return (
    hackerHouseActive(slop._creationTime) &&
    (!slop.productId || slop.productId === slop._id) &&
    slop.madeWith.some((tag) =>
      [HACKER_HOUSE.tag, ...HACKER_HOUSE.aliases].some((name) => name.toLowerCase() === tag.trim().toLowerCase()),
    )
  );
}
