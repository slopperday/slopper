/** Username rules, shared by the app server and Convex. */

/** Paths and words that would make confusing handles. */
const RESERVED = new Set([
  "admin",
  "api",
  "auth",
  "help",
  "mcp",
  "media",
  "moderator",
  "new",
  "root",
  "settings",
  "slopper",
  "support",
  "today",
  "wall",
]);

export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,28}[a-z0-9])?$/;

export function normalizeUsername(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 30);
}

export function usernameProblem(username: string): string | null {
  if (!USERNAME_PATTERN.test(username)) return "Use 1–30 letters, numbers, dashes or underscores.";
  if (RESERVED.has(username)) return "That name is reserved.";
  return null;
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "slop"
  );
}
