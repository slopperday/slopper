import { api } from "../convex/_generated/api.js";
import { expect, test } from "./fixtures.ts";
import { E2E_WALLET } from "./ports.ts";

test.describe("traction", () => {
  test("connecting a wallet puts its payments on the board, and hiding it takes them off", async ({ seed }) => {
    const maker = await seed.user("earner");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(maker);

    await page.goto(slop.path);
    await expect(page.getByRole("heading", { name: "Show real traction here" })).toBeVisible();
    await page.getByRole("link", { name: "Connect a source" }).click();

    await page.getByText("Solana wallet", { exact: true }).click();
    await page.getByLabel("Wallet address").fill("not-a-wallet");
    await page.getByRole("button", { name: "Connect Solana wallet" }).click();
    await expect(page.getByRole("alert")).toHaveText("That isn't a Solana wallet address.");

    await page.getByLabel("Wallet address").fill(E2E_WALLET);
    await page.getByRole("button", { name: "Connect Solana wallet" }).click();
    await expect(page.getByRole("status")).toHaveText("Solana wallet is connected. The numbers are on the slop page.");

    // The fake RPC paid the wallet $12.50 an hour ago, which rounds to $13.
    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    const board = visitor.getByRole("region", { name: "Traction" });
    await expect(board.getByText("$13 30 days")).toBeAttached();
    await expect(board.getByText("via Solana wallet").first()).toBeVisible();

    await page.goto(`${slop.path}/edit#traction`);
    await page.getByRole("button", { name: "Shown to everyone" }).click();
    await expect(page.getByRole("status")).toHaveText("Only you see those numbers now.");
    await visitor.reload();
    await expect(visitor.getByRole("region", { name: "Traction" })).toHaveCount(0);
  });

  test("analytics show who's on it now, and the numbers update live", async ({ seed, convex }) => {
    const maker = await seed.user("counter");
    const slop = await seed.slop(maker);
    const today = new Date().toISOString().slice(0, 10);
    const integrationId = await convex.mutation(api.integrations.connect, {
      userId: maker.id,
      slopId: slop.id,
      provider: "posthog",
      settings: { host: "https://us.posthog.com", projectId: "1", signupEvent: "sign_up" },
      sealedSecret: null,
      public: true,
    });
    const report = (live: number) =>
      convex.mutation(api.integrations.record, {
        integrationId,
        outcome: {
          ok: true,
          merge: "replace",
          days: [{ date: today, people: 41, signups: 3 }],
          live,
          snapshot: { people30: 962 },
          cursor: null,
        },
      });
    await report(23);

    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    await expect(visitor.getByText("23 on it now")).toBeVisible();
    const board = visitor.getByRole("region", { name: "Traction" });
    await expect(board.getByText("41 today")).toBeAttached();
    await expect(board.getByText("962 30 days")).toBeAttached();
    await expect(board.getByText("38 more people")).toBeVisible();

    await report(31);
    await expect(visitor.getByText("31 on it now")).toBeVisible();
  });
});
