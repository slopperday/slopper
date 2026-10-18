import { EVENTS } from "../events";
import { stringProperty } from "../properties";
import type { PropertyFilter } from "./queries";
import { type EventRow, matchesAll } from "./rows";

/**
 * Experiments: people see a variant of a flag (`$featureFlagCalled`), and
 * the experiment counts who among them went on to do the goal. Results are
 * Bayesian: each variant's conversion rate as a Beta distribution, and the
 * chance each is best, by sampling.
 */

export interface ExperimentQuery {
  flag: string;
  variants: readonly string[];
  goal: { event: string; filters?: PropertyFilter[] };
  /** From when it started to when it stopped (or now). */
  range: { from: number; to: number };
}

export interface VariantResult {
  key: string;
  /** People who saw it. */
  exposed: number;
  /** Of those, people who did the goal after first seeing it. */
  converted: number;
  rate: number;
  /** Where the true rate is, 95% sure: [low, high]. */
  interval: [number, number];
  /** The chance this variant converts best (0 to 1). */
  chanceToWin: number;
}

export interface ExperimentResult {
  variants: VariantResult[];
  /** The variant at least 95% likely to be best, once every variant has enough people; else null. */
  winner: string | null;
  /** People each variant needs before a winner is called. */
  minimumExposure: number;
}

export const MINIMUM_EXPOSURE = 100;
const DRAWS = 20_000;
const CONFIDENCE = 0.95;

/** A small, fast seeded generator, so the same counts always give the same chances. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(random: () => number): number {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Gamma(shape, 1) for shape >= 1 (Marsaglia and Tsang). */
function gamma(shape: number, random: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = standardNormal(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** A draw from Beta(a, b), a and b at least 1. */
export function betaSample(a: number, b: number, random: () => number): number {
  const x = gamma(a, random);
  return x / (x + gamma(b, random));
}

/**
 * Chances to win and 95% intervals, from uniform priors: each variant's
 * rate is Beta(1 + converted, 1 + not converted).
 */
export function compareVariants(
  counts: readonly { key: string; exposed: number; converted: number }[],
  seed = 1,
): VariantResult[] {
  const random = seededRandom(seed);
  const samples = counts.map(() => new Float64Array(DRAWS));
  const wins = counts.map(() => 0);
  for (let draw = 0; draw < DRAWS; draw += 1) {
    let best = -1;
    let bestRate = -1;
    counts.forEach((count, index) => {
      const rate = betaSample(1 + count.converted, 1 + Math.max(0, count.exposed - count.converted), random);
      const variantSamples = samples[index];
      if (variantSamples) variantSamples[draw] = rate;
      if (rate > bestRate) {
        bestRate = rate;
        best = index;
      }
    });
    if (best >= 0) wins[best] = (wins[best] ?? 0) + 1;
  }
  return counts.map((count, index) => {
    const sorted = Array.from(samples[index] ?? []).sort((a, b) => a - b);
    const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
    return {
      key: count.key,
      exposed: count.exposed,
      converted: count.converted,
      rate: count.exposed === 0 ? 0 : count.converted / count.exposed,
      interval: [at((1 - CONFIDENCE) / 2), at(1 - (1 - CONFIDENCE) / 2)],
      chanceToWin: (wins[index] ?? 0) / DRAWS,
    };
  });
}

/**
 * Feed `$featureFlagCalled` events with `addExposure` and goal events with
 * `addGoal`, in any order; a person counts for the first variant they saw.
 */
export class ExperimentAggregator {
  private readonly firstSeen = new Map<string, { at: number; variant: string }>();
  private readonly goals = new Map<string, number[]>();

  constructor(private readonly query: ExperimentQuery) {}

  addExposure(event: EventRow): void {
    if (event.name !== EVENTS.flagCalled || stringProperty(event.properties, "flag") !== this.query.flag) return;
    const variant = stringProperty(event.properties, "variant");
    if (!variant || !this.query.variants.includes(variant)) return;
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    const seen = this.firstSeen.get(event.personId);
    if (!seen || event.timestamp < seen.at) this.firstSeen.set(event.personId, { at: event.timestamp, variant });
  }

  addGoal(event: EventRow): void {
    if (event.name !== this.query.goal.event || !matchesAll(event, this.query.goal.filters)) return;
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    const times = this.goals.get(event.personId) ?? [];
    times.push(event.timestamp);
    this.goals.set(event.personId, times);
  }

  result(seed = 1): ExperimentResult {
    const counts = new Map(this.query.variants.map((key) => [key, { key, exposed: 0, converted: 0 }]));
    for (const [personId, seen] of this.firstSeen) {
      const count = counts.get(seen.variant);
      if (!count) continue;
      count.exposed += 1;
      if ((this.goals.get(personId) ?? []).some((at) => at >= seen.at)) count.converted += 1;
    }
    const variants = compareVariants([...counts.values()], seed);
    const enough = variants.every((variant) => variant.exposed >= MINIMUM_EXPOSURE);
    const best = variants.reduce<VariantResult | null>(
      (top, variant) => (!top || variant.chanceToWin > top.chanceToWin ? variant : top),
      null,
    );
    return {
      variants,
      winner: enough && best && best.chanceToWin >= CONFIDENCE ? best.key : null,
      minimumExposure: MINIMUM_EXPOSURE,
    };
  }
}
