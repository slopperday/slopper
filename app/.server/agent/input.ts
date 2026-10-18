/**
 * Small, strict readers for untrusted JSON from agents. Each one either
 * returns the typed value or throws an `ApiError` naming the bad field.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown, name = "input"): JsonObject {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, `${name} must be an object.`);
  return value as JsonObject;
}

export function optionalString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ApiError(400, `${key} must be a string.`);
  return value;
}

export function requiredString(input: JsonObject, key: string): string {
  const value = optionalString(input, key);
  if (!value?.trim()) throw new ApiError(400, `${key} is required.`);
  return value;
}

export function optionalNumber(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiError(400, `${key} must be a number.`);
  return value;
}

export function optionalBoolean(input: JsonObject, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new ApiError(400, `${key} must be true or false.`);
  return value;
}

export function optionalStrings(input: JsonObject, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ApiError(400, `${key} must be a list of strings.`);
  }
  return value;
}

export function optionalUpdateLinks(
  input: JsonObject,
  key: string,
): { kind?: string; url?: string; preview?: boolean }[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ApiError(400, `${key} must be a list of { kind, url, preview }.`);
  return value.map((item, index) => {
    const link = asObject(item, `${key}[${index}]`);
    return {
      kind: optionalString(link, "kind"),
      url: optionalString(link, "url"),
      preview: optionalBoolean(link, "preview"),
    };
  });
}

export function optionalFeatures(input: JsonObject, key: string): { title?: string; body?: string }[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ApiError(400, `${key} must be a list of { title, body }.`);
  return value.map((item, index) => {
    const feature = asObject(item, `${key}[${index}]`);
    return { title: optionalString(feature, "title"), body: optionalString(feature, "body") };
  });
}

export function optionalLinks(input: JsonObject, key: string): { kind?: string; url?: string }[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ApiError(400, `${key} must be a list of { kind, url }.`);
  return value.map((item, index) => {
    const link = asObject(item, `${key}[${index}]`);
    return { kind: optionalString(link, "kind"), url: optionalString(link, "url") };
  });
}
