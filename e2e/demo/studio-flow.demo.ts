import { expect, type Page, test } from "@playwright/test";
import { postField } from "../fixtures.ts";
import { PORTS } from "../ports.ts";

/**
 * The Studio from a stranger's first visit to a sent post, recorded as a
 * video (playwright.demo.config.ts). GitHub, X and LinkedIn are stand-ins
 * (./fake-networks.ts): their sign-in windows are drawn here, their APIs
 * answered in the app server. Everything in between is the real Slopper.
 */

const PAUSE = 1400;

/** A caption across the bottom of the video, so it reads without sound. */
async function say(page: Page, step: string, words: string): Promise<void> {
  await page.evaluate(
    ([step, words]) => {
      let box = document.getElementById("demo-caption");
      if (!box) {
        box = document.createElement("div");
        box.id = "demo-caption";
        box.style.cssText =
          "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:min(880px,90vw);" +
          "padding:14px 22px;border-radius:18px;background:rgba(20,18,15,.92);color:#fff;font:600 19px/1.4 system-ui;" +
          "box-shadow:0 10px 40px rgba(0,0,0,.25);pointer-events:none;text-align:center";
        document.body.append(box);
      }
      box.textContent = "";
      const label = document.createElement("span");
      label.textContent = step;
      label.style.cssText = "color:#facc15;margin-right:10px";
      box.append(label, words);
    },
    [step, words],
  );
  await page.waitForTimeout(PAUSE);
}

/** A network's sign-in window, as a stand-in: it hands straight back to Slopper with a made-up code. */
function consentPage(network: string, colour: string, asks: string[], back: URL): string {
  return `<!doctype html><meta charset="utf-8"><title>${network}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:${colour};font:16px/1.5 system-ui}
  main{background:#fff;border-radius:20px;padding:36px 40px;width:420px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
  h1{font-size:22px;margin:0 0 6px} p{color:#555;margin:0 0 16px} li{margin:4px 0}
  a{display:block;margin-top:24px;text-align:center;background:${colour};color:#fff;padding:12px;border-radius:999px;
    font-weight:700;text-decoration:none} small{display:block;margin-top:14px;color:#999;text-align:center}
</style>
<main><h1>Slopper wants to use your ${network} account</h1><p>Signed in as <b>Ada Builds</b>. It will be able to:</p>
<ul>${asks.map((ask) => `<li>${ask}</li>`).join("")}</ul>
<a href="${back.href}">Authorize Slopper</a><small>A stand-in for ${network}, for this walkthrough.</small></main>`;
}

/**
 * Slopper's `/auth/<provider>` sends the browser on to the network, and
 * Playwright can't catch a redirect: so take Slopper's answer, and show the
 * stand-in window where the network's would be.
 */
async function standIn(page: Page, provider: string, network: string, colour: string, asks: string[]) {
  await page.route(
    (url) => url.pathname === `/auth/${provider}`,
    async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const asked = new URL(response.headers().location!);
      const back = new URL(asked.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", `demo-${provider}`);
      back.searchParams.set("state", asked.searchParams.get("state")!);
      const { location: _, ...headers } = response.headers();
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-type": "text/html; charset=utf-8" },
        body: consentPage(network, colour, asks, back),
      });
    },
  );
}

async function picture(page: Page): Promise<Buffer> {
  const canvas = await page.context().newPage();
  await canvas.setViewportSize({ width: 1200, height: 675 });
  await canvas.setContent(
    `<div style="width:1200px;height:675px;display:grid;place-items:center;background:linear-gradient(135deg,#16a34a,#facc15);font:800 96px system-ui;color:#14120f;text-align:center">Week 12<br><span style="font-size:52px">what I shipped</span></div>`,
  );
  const shot = await canvas.screenshot();
  await canvas.close();
  return shot;
}

test("the Studio, start to finish", async ({ page }) => {
  await standIn(page, "github", "GitHub", "#24292f", ["Read your name and profile picture", "Read your email address"]);
  await standIn(page, "x", "X", "#000000", ["Post and repost for you", "Read your posts' stats"]);
  await standIn(page, "linkedin", "LinkedIn", "#0a66c2", ["Post to your feed", "Read your name and photo"]);
  const shot = await picture(page);

  await test.step("sign up", async () => {
    await page.goto("/");
    await say(page, "1 · Sign up", "A new visitor signs up with GitHub. No password to make.");
    await page.getByRole("banner").getByRole("link", { name: "Start slopping" }).click();
    await say(page, "1 · Sign up", "Pick a way in.");
    await page
      .getByRole("link", { name: "Continue with GitHub" })
      .or(page.getByRole("button", { name: "Continue with GitHub" }))
      .first()
      .click();
    await say(page, "1 · Sign up", "GitHub asks once…");
    await page.getByRole("link", { name: "Authorize Slopper" }).click();
    await page.waitForLoadState("networkidle");
    await say(page, "1 · Sign up", "…and Ada has an account.");
  });

  await test.step("open the Studio", async () => {
    await page.getByRole("banner").getByRole("link", { name: "Studio" }).click();
    await expect(page.getByRole("heading", { name: "Studio", level: 1 })).toBeVisible();
    await say(page, "2 · The Studio", "First visit: it says what it does and the one thing to do first.");
    await page.getByRole("link", { name: "Connect your first account" }).click();
  });

  await test.step("connect X and LinkedIn", async () => {
    await say(page, "3 · Connect accounts", "Each network signs in its own way. X first.");
    const x = page.getByRole("link", { name: "Connect X · Slopper app" });
    await x.scrollIntoViewIfNeeded();
    await say(page, "3 · Connect accounts", "One button per network.");
    await x.click();
    await say(page, "3 · Connect accounts", "X asks Ada to let Slopper post for her.");
    await page.getByRole("link", { name: "Authorize Slopper" }).click();
    await expect(page.getByText("Connected @adabuilds on X.")).toBeVisible();
    await say(page, "3 · Connect accounts", "Connected. Now LinkedIn, the same way.");
    const linkedin = page.getByRole("link", { name: "Connect LinkedIn" });
    await linkedin.scrollIntoViewIfNeeded();
    await linkedin.click();
    await page.getByRole("link", { name: "Authorize Slopper" }).click();
    await page.waitForLoadState("networkidle");
    await say(page, "3 · Connect accounts", "Both accounts are connected.");
  });

  await test.step("write a post", async () => {
    await page.getByRole("banner").getByRole("link", { name: "Studio" }).click();
    await say(page, "4 · Write", "Back in the Studio. Nothing picked yet, so it asks who to post as.");
    await page.getByRole("button", { name: /X · adabuilds/ }).click();
    await page.getByRole("button", { name: /LinkedIn · Ada Builds/ }).click();
    await say(page, "4 · Write", "Tap X and LinkedIn. They show up under “To”.");
    await page.getByRole("button", { name: "Done" }).click();
    await say(page, "4 · Write", "It's about anything: no product needed.");
    const post = postField(page);
    await post.click();
    await post.pressSequentially(
      "Week 12 of building in public: shipped dark mode, cut the load time in half, and finally wrote the docs. What should I build next?",
      { delay: 18 },
    );
    await say(page, "4 · Write", "The checklist on the right fills in as you type.");
    await page.locator('input[type="file"][accept^="image"]').setInputFiles({
      name: "week-12.png",
      mimeType: "image/png",
      buffer: shot,
    });
    await expect(page.getByLabel("Uploading")).toHaveCount(0);
    await say(page, "4 · Write", "Add a picture: drop it in, paste it, or use the toolbar.");
    await page.getByRole("group", { name: "Words for" }).getByRole("button", { name: "X", exact: true }).click();
    await say(page, "4 · Write", "Want different words on X? Its own tab. Otherwise it uses the shared words.");
    await page.getByRole("group", { name: "Words for" }).getByRole("button", { name: "Everywhere" }).click();
    const previews = page.getByRole("complementary", { name: "Previews" });
    await previews.getByRole("button", { name: /^LinkedIn:/ }).click();
    await say(page, "4 · Write", "See how it looks on each network before it goes.");
  });

  await test.step("keep it as a workflow", async () => {
    await page.getByRole("button", { name: "Save as a workflow" }).click();
    await page.getByLabel("Name this workflow").pressSequentially("Weekly update", { delay: 30 });
    await say(page, "5 · Workflows", "Ada always posts to X and LinkedIn: save that, and new posts start with it.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await say(page, "5 · Workflows", "Saved, and starred as the default.");
  });

  await test.step("post", async () => {
    const send = page.getByRole("button", { name: /Post to 2 accounts/ });
    await send.scrollIntoViewIfNeeded();
    await say(page, "6 · Post", "Now, the queue, or a time. Now it is.");
    await send.click();
    await page.waitForURL(/\/studio\/posts\//);
    await say(page, "6 · Post", "It goes out to each account, and this page follows along live.");
    await expect(page.getByRole("cell", { name: /^Posted/ })).toHaveCount(2, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await say(page, "6 · Post", "Both sent, with links to the posts. Stats come back here later.");
  });

  await test.step("what the networks got", async () => {
    await page.goto(`http://127.0.0.1:${PORTS.demoNetworks}/`);
    await say(page, "Behind the scenes", "What the stand-in X and LinkedIn received.");
    await page.waitForTimeout(1000);
  });

  await test.step("next time", async () => {
    await page.goto("/studio");
    await say(page, "7 · Next time", "A new post already has X and LinkedIn picked: the workflow is kept.");
    await expect(page.getByRole("list", { name: "Posting as" }).getByRole("listitem")).toHaveCount(2);
    await page.waitForTimeout(2000);
  });
});
