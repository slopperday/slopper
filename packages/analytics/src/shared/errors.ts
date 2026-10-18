import { hashOf } from "./hash";
import type { Properties } from "./properties";

/**
 * Errors as `$exception` events: what was thrown, where, and a fingerprint
 * that groups the same error into one issue. The fingerprint comes from the
 * error's type and its message with the parts that vary (numbers, ids,
 * quoted values) taken out; stack positions change with every build, so
 * they're kept to read, not to group by.
 */

export type ExceptionSource = "uncaught" | "rejection" | "reported" | "server";

const MESSAGE_LENGTH = 500;
const STACK_LINES = 20;
const STACK_LINE_LENGTH = 300;

export interface DescribedError {
  type: string;
  message: string;
  stack: string | null;
}

/** Whatever was thrown, as a type, a message and (for real errors) a stack. */
export function describeError(value: unknown): DescribedError {
  if (value instanceof Error) {
    return {
      type: value.name || "Error",
      message: value.message.slice(0, MESSAGE_LENGTH),
      stack: value.stack ? cleanStack(value.stack) : null,
    };
  }
  if (typeof value === "string") return { type: "Error", message: value.slice(0, MESSAGE_LENGTH), stack: null };
  return { type: "Error", message: `Something that isn't an error was thrown (${typeof value}).`, stack: null };
}

/** A stack cut short, with query strings taken off addresses (they can carry tokens). */
export function cleanStack(stack: string): string {
  return stack
    .split("\n")
    .slice(0, STACK_LINES)
    .map((line) => line.replace(/\?[^\s:)]*/g, "").slice(0, STACK_LINE_LENGTH))
    .join("\n");
}

/** A message with what changes from one occurrence to the next taken out. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/(["'`]).*?\1/g, "<value>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[a-z0-9]{24,}\b/gi, "<id>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .trim();
}

export function errorFingerprint(type: string, message: string): string {
  return hashOf(`${type}\n${normalizeMessage(message)}`);
}

/** The properties of a `$exception` event for whatever was thrown. */
export function exceptionProperties(value: unknown, source: ExceptionSource): Properties {
  const { type, message, stack } = describeError(value);
  return { type, message, stack, source, fingerprint: errorFingerprint(type, message) };
}
