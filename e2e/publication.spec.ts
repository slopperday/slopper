import { bucketObjects, checkRequests, expect, test } from "./fixtures.ts";

/**
 * A small, plain PDF that passes the safety scan, with words the fake check reads as its text
 * (e2e/stack.ts). `catalog` goes in its catalog, for a PDF the scan should refuse.
 */
function pdfWith(text: string, catalog = ""): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${text}\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${catalog}>>\nendobj\n` +
      "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "latin1",
  );
}

test.describe("publications", () => {
  test("a maker uploads a PDF they wrote, launches it with no link, and everyone can read it", async ({
    seed,
    stack,
  }) => {
    const id = Date.now().toString(36);
    const page = await seed.pageAs(await seed.user("writer"));
    await page.goto("/new");
    const name = `Field guide ${id}`;
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Tagline").fill("How to ship something every day");
    await page.getByLabel("Category").selectOption("learning");

    // Neither a link nor a PDF: there's nothing to try or read yet.
    await page.getByRole("button", { name: "Throw it at the wall" }).click();
    await expect(page.getByText("Add at least one link so people can try it, or upload a PDF.")).toBeVisible();

    const fileName = `field-guide-${id}.pdf`;
    await page
      .locator('input[type="file"][accept*="pdf"]')
      .setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: pdfWith("Chapter one: ship it.") });
    await expect(page.getByRole("link", { name: new RegExp(fileName) })).toBeVisible();
    const checked = (await checkRequests(stack)).find((request) => request.text.includes(fileName));
    expect(checked).toMatchObject({ files: 1, images: 0, verdict: "ok" });
    const stored = (await bucketObjects(stack)).find(
      (object) => object.key.startsWith("publications/") && object.contentType === "application/pdf",
    );
    expect(stored?.key).toMatch(/^publications\/[\w-]+\.pdf$/);

    await page.getByRole("button", { name: "Throw it at the wall" }).click();
    await expect(page.getByRole("status")).toHaveText(`${name} is on the wall.`);
    const path = new URL(page.url()).pathname;

    const visitor = await seed.visitorPage();
    await visitor.goto(path);
    const card = visitor.getByRole("region", { name: "Publication" });
    await expect(card).toContainText(fileName);
    const read = visitor.getByRole("link", { name: "Read it" });
    await expect(read).toHaveAttribute("href", /\/publications\/[\w-]+\.pdf$/);
    const served = await fetch((await read.getAttribute("href")) ?? "");
    expect(served.headers.get("content-type")).toBe("application/pdf");
  });

  test("an agent's blocked PDF is refused, and a clean one launches through the API", async ({
    seed,
    stack,
    request,
  }) => {
    const maker = await seed.user("author");
    const auth = { authorization: `Bearer ${await seed.apiToken(maker)}` };
    const before = (await bucketObjects(stack)).length;

    const blocked = await request.post(`${stack.appUrl}/api/v1/publications?fileName=nope.pdf`, {
      headers: { ...auth, "content-type": "application/pdf" },
      data: pdfWith("[e2e:blocked]"),
    });
    expect(blocked.status()).toBe(400);
    expect(await blocked.json()).toMatchObject({ error: "This PDF can't go on Slopper." });
    expect(await bucketObjects(stack)).toHaveLength(before);

    // Slopper's own safety scan refuses a PDF that runs a script when it's opened, before any check.
    const checksBefore = (await checkRequests(stack)).length;
    const scripted = await request.post(`${stack.appUrl}/api/v1/publications?fileName=script.pdf`, {
      headers: { ...auth, "content-type": "application/pdf" },
      data: pdfWith("A harmless zine.", "/OpenAction << /S /JavaScript /JS (app.alert(1)) >> "),
    });
    expect(scripted.status()).toBe(400);
    expect((await scripted.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("scripts, forms or actions"),
    });
    expect(await checkRequests(stack)).toHaveLength(checksBefore);
    expect(await bucketObjects(stack)).toHaveLength(before);

    const notPdf = await request.post(`${stack.appUrl}/api/v1/publications`, {
      headers: auth,
      data: { base64: Buffer.from("plain text").toString("base64") },
    });
    expect(await notPdf.json()).toMatchObject({ error: "Use a PDF." });

    const uploaded = await request.post(`${stack.appUrl}/api/v1/publications`, {
      headers: auth,
      data: { base64: pdfWith("A zine about slop.").toString("base64"), fileName: "zine.pdf" },
    });
    expect(uploaded.status()).toBe(201);
    const { id, fileName } = (await uploaded.json()) as { id: string; fileName: string };
    expect(fileName).toBe("zine.pdf");

    const launched = await request.post(`${stack.appUrl}/api/v1/slops`, {
      headers: auth,
      data: { name: `Zine ${Date.now().toString(36)}`, tagline: "A zine", category: "creative", publication: id },
    });
    expect(launched.status()).toBe(201);
    expect(await launched.json()).toMatchObject({ slop: { publication: true } });
  });
});
