import { expect, test } from "./fixtures.ts";

// Subscribing for real needs the browser's own push service (Google's, for
// Chromium), so these stop at our side of it. Delivery is covered in
// tests/push.test.ts with real encryption against a fake push service.

const KEYS = { p256dh: `B${"x".repeat(86)}`, auth: "a".repeat(22) };

test.describe("browser notifications", () => {
  test("settings offers them, with the worker and manifest they need", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("pinged"));
    const section = page.getByRole("region", { name: "Browser notifications" });

    // Headless Chromium always reports notifications as blocked, granted or not.
    await page.goto("/settings");
    await expect(section.getByText("Your browser is blocking notifications from Slopper.")).toBeVisible();
    await expect(section.getByRole("button")).toHaveCount(0);

    // A browser that hasn't been asked yet.
    await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "default" }));
    await page.reload();
    await expect(section.getByRole("button", { name: "Turn on" })).toBeEnabled();
    await expect(section.getByText("Off in this browser")).toBeVisible();

    const worker = await page.request.get("/sw.js");
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("javascript");
    expect(await worker.text()).toContain("showNotification");

    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect(await manifest.json()).toMatchObject({ name: "Slopper", display: "standalone" });
  });

  test("only push services' subscriptions are stored, and only for signed-in people", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("subscriber"));
    await page.goto("/settings");
    const call = (method: string, body: unknown) =>
      page.evaluate(
        async ([method, body]) =>
          (
            await fetch("/api/push", {
              method: method as string,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            })
          ).status,
        [method, body] as const,
      );
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}`;

    expect(await call("POST", { endpoint, expirationTime: null, keys: KEYS })).toBe(204);
    expect(await call("POST", { endpoint, expirationTime: null, keys: KEYS })).toBe(204);
    expect(await call("POST", { endpoint: "https://example.com/hook", keys: KEYS })).toBe(400);
    expect(await call("POST", { endpoint, keys: { ...KEYS, auth: "not base64!" } })).toBe(400);
    expect(await call("DELETE", { endpoint })).toBe(204);

    const visitor = await seed.visitorPage();
    await visitor.goto("/");
    const status = await visitor.evaluate(
      async (body) =>
        (
          await fetch("/api/push", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
      { endpoint, keys: KEYS },
    );
    expect(status).toBe(401);
  });
});
