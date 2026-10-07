/** Where the e2e stack listens. Away from dev's 5173 and 3210 so both can run at once. */
export const PORTS = {
  app: 4173,
  convex: 3410,
  convexSite: 3411,
  check: 4174,
} as const;

/** Written by `e2e/stack.ts`, read by the fixtures. */
export const STACK_FILE = ".e2e/stack.json";

/** The username the stack makes a moderator. */
export const E2E_ADMIN = "e2e-admin";

export interface Stack {
  appUrl: string;
  convexUrl: string;
  checkUrl: string;
  adminKey: string;
  issuer: string;
  privateKey: string;
}

/** One request the fake content check received. */
export interface FakeCheckRequest {
  text: string;
  images: number;
  verdict: "ok" | "mature" | "blocked";
}
