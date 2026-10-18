import { afterEach, describe, expect, it, vi } from "vite-plus/test";

/** The app server's errors on their way to analytics: who, where, and never a second failure. */

const mutation = vi.fn<(reference: unknown, args: Record<string, unknown>) => Promise<null>>();
vi.mock("~/.server/convex", () => ({ convex: { mutation } }));

const { reportServerError } = await import("~/.server/errors");

afterEach(() => {
  mutation.mockReset();
  vi.restoreAllMocks();
});

describe("reportServerError", () => {
  it("sends what broke, on which page, for the visitor's analytics id", async () => {
    mutation.mockResolvedValue(null);
    const request = new Request("https://slopper.day/unsubscribe/secret-token?x=1", {
      headers: { cookie: "sa_id=visitor-9" },
    });
    await reportServerError(new TypeError("Slop 42 is undefined"), request);
    expect(mutation).toHaveBeenCalledOnce();
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      distinctId: "visitor-9",
      path: "/unsubscribe/:token",
      type: "TypeError",
      message: "Slop 42 is undefined",
    });
  });

  it("names nobody for someone who turned analytics off", async () => {
    mutation.mockResolvedValue(null);
    await reportServerError("boom", new Request("https://slopper.day/", { headers: { cookie: "sa_id=v; sa_off=1" } }));
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({ distinctId: null, message: "boom" });
  });

  it("logs a report that fails instead of throwing it", async () => {
    mutation.mockRejectedValue(new Error("Convex is down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(reportServerError(new Error("boom"), new Request("https://slopper.day/"))).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith("This error didn't reach analytics:", expect.any(Error));
  });
});
