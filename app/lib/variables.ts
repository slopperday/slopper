/**
 * Words that fill themselves in when a post goes out. Variables ({date},
 * {product}…) read the moment of sending; spintax ({Hi|Hello|Hey}) picks
 * one choice per account, so the same post reads a little differently on
 * each, and networks that refuse duplicates take every copy.
 */

export const VARIABLES = {
  date: "today's date, like 3 November 2026",
  day: "the weekday, like Tuesday",
  time: "the time it goes out, like 09:30",
  product: "the product's name",
  link: "the post's link",
  network: "the network's name, like Instagram",
} as const;

export type VariableName = keyof typeof VARIABLES;

export interface VariableValues {
  /** When it goes out, and the time zone to read it in. */
  at: number;
  timeZone: string;
  product: string | null;
  link: string | null;
  network: string;
}

/** Fills in {date}, {day}, {time}, {product}, {link} and {network}. Unknown names stay as written. */
export function applyVariables(text: string, values: VariableValues): string {
  const zone = safeZone(values.timeZone);
  const at = new Date(values.at);
  const filled: Record<VariableName, string> = {
    date: at.toLocaleDateString("en-GB", { timeZone: zone, day: "numeric", month: "long", year: "numeric" }),
    day: at.toLocaleDateString("en-GB", { timeZone: zone, weekday: "long" }),
    time: at.toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }),
    product: values.product ?? "",
    link: values.link ?? "",
    network: values.network,
  };
  return text.replace(/\{(date|day|time|product|link|network)\}/g, (_, name: VariableName) => filled[name]);
}

function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** A small, stable hash, so the same account always gets the same pick. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Whether the words have spintax in them. */
export function hasSpintax(text: string): boolean {
  return /\{[^{}|]*\|[^{}]*\}/.test(text);
}

/** Picks one choice from each {a|b|c}, the same way every time for the same seed. Nested groups resolve inside out. */
export function spin(text: string, seed: string): string {
  let out = text;
  let round = 0;
  while (round++ < 10 && hasSpintax(out)) {
    let index = 0;
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, body: string) => {
      const choices = body.split("|");
      return choices[hash(`${seed}:${round}:${index++}`) % choices.length];
    });
  }
  return out;
}

/** Spintax first, then variables: what one account's copy says. */
export function personalize(text: string, seed: string, values: VariableValues): string {
  return applyVariables(spin(text, seed), values);
}
