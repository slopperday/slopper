import type { FlagCondition, FlagDefinition } from "@slopperday/analytics/shared/flags";
import type { PropertyFilter } from "@slopperday/analytics/shared/insights";

/**
 * The flag form at /analytics/flags, as plain fields: a flag's variants as
 * lines ("control 50"), who gets it as numbered groups of filters, and
 * payloads as lines (`test {"color":"red"}`). Pure, so it's tested.
 */

/** Groups of people the form shows ("who gets it", "or"), and filters per group. */
export const FORM_CONDITIONS = 3;
export const FORM_FILTERS = 3;

/** What flags can target on Slopper (app/.server/flags.ts `flagProperties`). */
export const FLAG_PROPERTIES = ["signedIn", "username", "accountDays", "staff", "country"] as const;

type Operator = PropertyFilter["operator"];

/** Comparisons, in the words the form and summaries use. */
export const OPERATORS: readonly { value: Operator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "notEquals", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "notContains", label: "doesn't contain" },
  { value: "isSet", label: "is set" },
  { value: "isNotSet", label: "isn't set" },
  { value: "greaterThan", label: "is more than" },
  { value: "lessThan", label: "is less than" },
];

function operatorOf(value: string): Operator | null {
  return OPERATORS.find((operator) => operator.value === value)?.value ?? null;
}

export interface FlagFields extends Omit<FlagDefinition, "active"> {
  name: string;
  description: string;
}

/** A filter's value as typed: numbers and true/false as themselves, the rest as text. */
function typedValue(text: string): string | number | boolean {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

/** Reads the form's fields; `get` returns "" for a field that isn't there. */
export function parseFlagForm(get: (name: string) => string): FlagFields {
  const variantLines = get("variants")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const variants = variantLines.length
    ? variantLines.map((line) => {
        const [key = "", weight = "1"] = line.split(/\s+/);
        return { key: key.toLowerCase(), weight: Number(weight) };
      })
    : null;
  const conditions: FlagCondition[] = [];
  for (let group = 0; group < FORM_CONDITIONS; group += 1) {
    const rollout = get(`c${group}_rollout`).trim();
    if (rollout === "") continue;
    const filters: PropertyFilter[] = [];
    for (let index = 0; index < FORM_FILTERS; index += 1) {
      const key = get(`c${group}_f${index}_key`).trim();
      const operator = operatorOf(get(`c${group}_f${index}_operator`).trim());
      if (!key || !operator) continue;
      filters.push(
        operator === "isSet" || operator === "isNotSet"
          ? { key, operator }
          : { key, operator, value: typedValue(get(`c${group}_f${index}_value`)) },
      );
    }
    const variant = get(`c${group}_variant`).trim().toLowerCase();
    conditions.push({ filters, rollout: Number(rollout), variant: variant || null });
  }
  const payloads: Record<string, string> = {};
  for (const line of get("payloads").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // On an on-or-off flag, the line is the payload for "on".
    if (!variants) {
      payloads.true = trimmed;
      continue;
    }
    const space = trimmed.search(/\s/);
    if (space > 0) payloads[trimmed.slice(0, space).toLowerCase()] = trimmed.slice(space + 1).trim();
  }
  return {
    key: get("key").trim().toLowerCase(),
    name: get("name").trim().slice(0, 100),
    description: get("description").trim().slice(0, 500),
    variants,
    conditions,
    payloads,
  };
}

/** A flag back as form fields, to change it. */
export function flagFormValues(flag: FlagFields): Record<string, string> {
  const values: Record<string, string> = {
    key: flag.key,
    name: flag.name,
    description: flag.description,
    variants: (flag.variants ?? []).map((variant) => `${variant.key} ${variant.weight}`).join("\n"),
    payloads: Object.entries(flag.payloads)
      .map(([key, payload]) => (flag.variants ? `${key} ${payload}` : payload))
      .join("\n"),
  };
  flag.conditions.slice(0, FORM_CONDITIONS).forEach((condition, group) => {
    values[`c${group}_rollout`] = String(condition.rollout);
    values[`c${group}_variant`] = condition.variant ?? "";
    condition.filters.slice(0, FORM_FILTERS).forEach((filter, index) => {
      values[`c${group}_f${index}_key`] = filter.key;
      values[`c${group}_f${index}_operator`] = filter.operator;
      values[`c${group}_f${index}_value`] = filter.value === undefined ? "" : String(filter.value);
    });
  });
  return values;
}

function filterWords(filter: PropertyFilter): string {
  const label = OPERATORS.find((operator) => operator.value === filter.operator)?.label ?? filter.operator;
  return filter.value === undefined ? `${filter.key} ${label}` : `${filter.key} ${label} ${String(filter.value)}`;
}

/** One line on who gets a flag: "everyone", "50% of staff is true → test · control/test". */
export function flagSummary(flag: Pick<FlagDefinition, "conditions" | "variants">): string {
  const who = flag.conditions.map((condition) => {
    const people = condition.filters.length === 0 ? "everyone" : condition.filters.map(filterWords).join(" and ");
    const share = condition.rollout >= 100 ? "" : `${condition.rollout}% of `;
    return `${share}${people}${condition.variant ? ` → ${condition.variant}` : ""}`;
  });
  const split = flag.variants ? ` · ${flag.variants.map((variant) => variant.key).join("/")}` : "";
  return `${who.join("; ") || "nobody"}${split}`;
}
