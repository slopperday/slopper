import { mkdirSync } from "node:fs";
import { expect, markdownField, modKey, test, write } from "./fixtures.ts";

/**
 * Markdown fields are canvist editors: Markdown formats as it's typed, the
 * form still sends Markdown, and a field the editor can't show faithfully
 * stays a plain text box. With EDITOR_SCREENSHOTS set, it saves the editor
 * to docs/editor/.
 */

const SHOTS = process.env.EDITOR_SCREENSHOTS ? "docs/editor" : null;

test("Markdown formats as it's typed, and the form sends Markdown", async ({ seed }) => {
  const maker = await seed.user("writer");
  const slop = await seed.slop(maker, { description: "Built on the bus.\nShipped at the stop." });
  const page = await seed.pageAs(maker);
  await page.goto(`${slop.path}/edit`);

  const description = markdownField(page, "Description");
  await expect(description.editor).toBeVisible();
  // Opening a field changes nothing: what's sent is what was there until someone types.
  await expect(description.value).toHaveValue("Built on the bus.\nShipped at the stop.");

  // Typed as people type: Enter for the next list item, Enter on an empty one to leave the list.
  await write(
    page,
    "Description",
    "## What it does\n- Tilt to roll\nShare a maze\n\nIt's **fast** and snake_case stays as typed.",
  );
  await expect(description.value).toHaveValue(
    "## What it does\n\n- Tilt to roll\n- Share a maze\n\nIt's **fast** and snake_case stays as typed.",
  );
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.locator(".markdown-editor").screenshot({ path: `${SHOTS}/1-typed.png` });
  }

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(slop.path);
  await expect(page.getByRole("heading", { name: "What it does" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Share a maze" })).toBeVisible();
  await expect(page.locator("strong", { hasText: "fast" })).toBeVisible();
});

test("Backspace straight after a shortcut puts the Markdown back", async ({ seed }) => {
  const maker = await seed.user("undoer");
  const slop = await seed.slop(maker);
  const page = await seed.pageAs(maker);
  await page.goto(`${slop.path}/edit`);

  const { editor, value } = markdownField(page, "Description");
  await editor.click();
  await page.keyboard.press(`${await modKey(page)}+a`);
  await page.keyboard.press("Backspace");
  await editor.pressSequentially("## ");
  await page.keyboard.press("Backspace");
  await editor.pressSequentially("not a heading");
  await expect(value).toHaveValue(/^\\?#\\?# not a heading$/);
});

test("a field the editor can't show faithfully stays a plain text box", async ({ seed }) => {
  const maker = await seed.user("tables");
  const table = "| Level | Time |\n|---|---|\n| 1 | 0:42 |";
  const slop = await seed.slop(maker, { description: table });
  const page = await seed.pageAs(maker);
  await page.goto(`${slop.path}/edit`);

  // The editor loads, finds it would flatten the table, and leaves the textarea as it was.
  const textarea = page.getByRole("textbox", { name: "Description" });
  await expect(textarea).toHaveValue(table);
  await page.waitForTimeout(1500);
  await expect(textarea).toBeVisible();
  await expect(markdownField(page, "Description").editor).toHaveCount(0);
});

test("going back over formatting shows its Markdown, and editing it edits the formatting", async ({ seed }) => {
  const maker = await seed.user("revealer");
  const slop = await seed.slop(maker);
  const page = await seed.pageAs(maker);
  await page.goto(`${slop.path}/edit`);

  const { value } = markdownField(page, "Description");
  await write(page, "Description", "Say **bold** now");
  await expect(value).toHaveValue("Say **bold** now");
  const box = page.locator(".markdown-editor");
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/2-formatted.png` });

  // Back over " now": the caret meets the bold word, and its `**` shows.
  for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowLeft");
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/3-revealed.png` });

  // Backspace deletes one `*` of the closing `**`: bold becomes italic, then plain.
  await page.keyboard.press("Backspace");
  await expect(value).toHaveValue("Say *bold* now");
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/4-italic.png` });
  await page.keyboard.press("Backspace");
  await expect(value).toHaveValue("Say bold now");
});
