import type { PropertyFilter } from "./insights/queries";
import type { PropertyValue } from "./properties";

/**
 * Whether a property's value passes a filter. Shared by insights (event
 * properties) and feature flags (person properties), so a filter means the
 * same wherever it's written. Values compare as text, `contains` ignores
 * case, and the number comparisons only hold for numbers.
 */
export function matchesValue(value: PropertyValue | undefined, filter: PropertyFilter): boolean {
  const present = value !== undefined && value !== null;
  const text = present ? (Array.isArray(value) ? value.join(",") : String(value)) : "";
  const wanted = String(filter.value);
  switch (filter.operator) {
    case "isSet":
      return present;
    case "isNotSet":
      return !present;
    case "equals":
      return present && text === wanted;
    case "notEquals":
      return !present || text !== wanted;
    case "contains":
      return present && text.toLowerCase().includes(wanted.toLowerCase());
    case "notContains":
      return !present || !text.toLowerCase().includes(wanted.toLowerCase());
    case "greaterThan":
      return typeof value === "number" && typeof filter.value === "number" && value > filter.value;
    case "lessThan":
      return typeof value === "number" && typeof filter.value === "number" && value < filter.value;
  }
}
