import { describe, expect, it } from "vite-plus/test";
import { MAX_INFLATED_BYTES, pdfNames, scanPdf } from "~/.server/pdfSafety";

const encoder = new TextEncoder();

/** Bytes as they are: one byte per character, so binary stream data survives. */
function bytes(...parts: (string | Uint8Array)[]): Uint8Array<ArrayBuffer> {
  const chunks = parts.map((part) =>
    typeof part === "string" ? Uint8Array.from(part, (char) => char.charCodeAt(0)) : part,
  );
  const out = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** A small, plain PDF with `objects` between its catalog and its end. */
function pdf(objects: string | Uint8Array = "", catalog = "", trailer = "<< /Root 1 0 R >>"): Uint8Array<ArrayBuffer> {
  return bytes(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${catalog}>>\nendobj\n`,
    "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n",
    objects,
    `trailer\n${trailer}\n%%EOF\n`,
  );
}

async function deflate(text: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([typeof text === "string" ? encoder.encode(text) : text])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An object stream holding `objects`, deflated. */
async function objectStream(objects: string, extra = ""): Promise<Uint8Array<ArrayBuffer>> {
  const data = await deflate(objects);
  return bytes(
    `5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode ${extra}/Length ${data.byteLength} >>\nstream\n`,
    data,
    "\nendstream\nendobj\n",
  );
}

describe("PDF safety scan", () => {
  it("passes a plain PDF, clicked links, and binary stream data", async () => {
    expect(scanPdf(pdf())).toEqual({ safe: true });
    expect(
      scanPdf(pdf("3 0 obj\n<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://slopper.day) >> >>\nendobj\n")),
    ).toEqual({ safe: true });
    expect(
      scanPdf(
        pdf(
          "3 0 obj\n<< /Type /Annot /Subtype /Link /A 4 0 R >>\nendobj\n" +
            "4 0 obj\n<< /S /URI /URI (http://example.test) >>\nendobj\n",
        ),
      ),
    ).toEqual({ safe: true });
    // Image bytes that happen to spell a name are data, not a name, when /Length says so.
    const image = "binary /JS ( bytes /Launch";
    expect(scanPdf(pdf(`4 0 obj\n<< /Length ${image.length} >>\nstream\n${image}\nendstream\nendobj\n`))).toEqual({
      safe: true,
    });
    // And when /Length is an indirect object, as pdfTeX writes it.
    expect(
      scanPdf(
        pdf(`4 0 obj\n<< /Length 6 0 R >>\nstream\n${image}\nendstream\nendobj\n6 0 obj\n${image.length}\nendobj\n`),
      ),
    ).toEqual({ safe: true });
  });

  it("refuses scripts and actions that run on their own, however their names are spelled", async () => {
    const js = "<< /S /JavaScript /JS (app.alert(1)) >>";
    expect(scanPdf(pdf("", `/OpenAction ${js} `))).toEqual({
      safe: false,
      reason: "active",
      found: ["JavaScript", "JS", "OpenAction"],
    });
    expect(scanPdf(pdf("", "/AA << /O << /S /J#61vaScript /J#53 (x) >> >> "))).toMatchObject({
      reason: "active",
      found: ["JavaScript", "JS", "AA"],
    });
    for (const action of ["Launch", "SubmitForm", "ImportData", "GoToE", "GoToR"]) {
      expect(scanPdf(pdf(`3 0 obj\n<< /S /${action} /F (x) >>\nendobj\n`))).toMatchObject({
        reason: "active",
        found: [action],
      });
    }
    expect(scanPdf(pdf("", "/AcroForm << /XFA 9 0 R >> "))).toMatchObject({ found: ["XFA"] });
    expect(scanPdf(pdf("3 0 obj\n<< /S /URI /URI (javascript:alert(1)) >>\nendobj\n"))).toMatchObject({
      reason: "active",
      found: ["URI"],
    });
  });

  it.each([
    ["an inline catalog action", "", "/OpenAction << /S /URI /URI (https://example.test) >> ", "OpenAction"],
    [
      "an indirect catalog action",
      "4 0 obj\n<< /S /URI /URI (https://example.test) >>\nendobj\n",
      "/OpenAction 4 0 R ",
      "OpenAction",
    ],
    ["an escaped catalog hook", "", "/Open#41ction << /S /URI /URI (https://example.test) >> ", "OpenAction"],
    ["a document additional action", "", "/AA << /WC << /S /URI /URI (https://example.test) >> >> ", "AA"],
    [
      "a page additional action",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /AA << /O 4 0 R >> >>\nendobj\n" +
        "4 0 obj\n<< /S /URI /URI (https://example.test) >>\nendobj\n",
      "",
      "AA",
    ],
    [
      "an indirect additional-action dictionary",
      "4 0 obj\n<< /O 5 0 R >>\nendobj\n5 0 obj\n<< /S /URI /URI (https://example.test) >>\nendobj\n",
      "/AA 4 0 R ",
      "AA",
    ],
    [
      "an escaped annotation hook",
      "3 0 obj\n<< /Type /Annot /Subtype /Link /A#41 << /PO << /S /URI /URI (https://example.test) >> >> >>\nendobj\n",
      "",
      "AA",
    ],
    ["an opening destination", "", "/OpenAction [3 0 R /Fit] ", "OpenAction"],
  ])("refuses automatic hooks: %s", (_description, objects, catalog, hook) => {
    expect(scanPdf(pdf(objects, catalog))).toEqual({ safe: false, reason: "active", found: [hook] });
  });

  it.each(["OpenAction", "AA"])("refuses /%s hooks in compressed objects", async (hook) => {
    const hidden = await objectStream(`7 0 << /${hook} 8 0 R >>`);
    const action = "8 0 obj\n<< /S /URI /URI (https://example.test) >>\nendobj\n";

    expect(scanPdf(pdf(bytes(hidden, action)))).toEqual({ safe: false, reason: "active", found: [hook] });
  });

  it("finds a script packed inside a compressed object stream", async () => {
    const hidden = await objectStream("7 0 << /S /JavaScript /JS (app.alert(1)) >>");
    expect(scanPdf(pdf(hidden))).toMatchObject({
      safe: false,
      reason: "active",
      found: ["JavaScript", "JS"],
    });
    // A /Length that stops short can't cut the packed objects off: deflate says where it ends.
    const data = await deflate("7 0 << /S /Launch /F (calc.exe) >>");
    const short = bytes(
      "5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 3 >>\nstream\n",
      data,
      "\nendstream\nendobj\n",
    );
    expect(scanPdf(pdf(short))).toMatchObject({
      reason: "active",
      found: ["Launch"],
    });
    // A string in its dictionary can't hide /Type /ObjStm before it.
    const disguisedDict = await objectStream("7 0 << /S /JavaScript >>", "/Producer (0 0 obj) ");
    expect(scanPdf(pdf(disguisedDict))).toMatchObject({
      reason: "active",
    });
  });

  it("refuses object streams it can't read: other filters, predictors, or a bomb", async () => {
    const plain = (dict: string) => pdf(`5 0 obj\n<< ${dict} /Length 4 >>\nstream\nabcd\nendstream\nendobj\n`);
    expect(scanPdf(plain("/Type /ObjStm /Filter /LZWDecode"))).toMatchObject({ reason: "uninspectable" });
    expect(scanPdf(plain("/Type /ObjStm /Filter /FlateDecode /DecodeParms << /Predictor 12 >>"))).toMatchObject({
      reason: "uninspectable",
    });
    expect(scanPdf(plain("/Type /ObjStm /Filter /FlateDecode"))).toMatchObject({ reason: "uninspectable" });
    const bomb = await objectStream(" ".repeat(MAX_INFLATED_BYTES + 1));
    expect(scanPdf(pdf(bomb))).toMatchObject({ reason: "uninspectable" });
  });

  it("scans unfiltered and repeatedly filtered object streams, including harmless ones", async () => {
    for (const object of ["<< /S /JavaScript /JS (app.alert(1)) >>", "<< /Type /Example >>"]) {
      const plain = bytes(`7 0 ${object}`);
      const twice = await deflate(await deflate(plain));

      for (const [data, filter] of [
        [plain, ""],
        [plain, "/Filter null"],
        [plain, "/Filter []"],
        [twice, "/Filter [/FlateDecode /FlateDecode]"],
        [twice, "/F#69lter [ /FlateDecode % first stage\n /Flate#44ecode ]"],
      ] satisfies [Uint8Array<ArrayBuffer>, string][]) {
        const packed = bytes(
          `5 0 obj\n<< /Type /ObjStm /N 1 /First 4 ${filter} /Length ${data.length} >>\nstream\n`,
          data,
          "\nendstream\nendobj\n",
        );
        const expected = object.includes("JavaScript")
          ? { safe: false, reason: "active", found: ["JavaScript", "JS"] }
          : { safe: true };

        expect(scanPdf(pdf(packed))).toEqual(expected);
      }
    }
  });

  it("uses dictionary values, ignoring filter-like text in strings, comments and nested dictionaries", async () => {
    const data = await objectStream(
      "7 0 << /Type /Example >>",
      "/Producer (0 0 obj \\( /Filter /Unknown \\)) /Meta << /Filter /Unknown >> % /Filter /Unknown\n",
    );

    expect(scanPdf(pdf(data))).toEqual({ safe: true });
  });

  it("fails closed on unsupported, indirect, ambiguous or incomplete filter pipelines", async () => {
    const data = await deflate("7 0 << /Type /Example >>");

    for (const filter of [
      "/Filter /Unknown",
      "/Filter 9 0 R",
      "/Filter [/FlateDecode /ASCII85Decode]",
      "/Filter [/FlateDecode 9 0 R]",
      "/Filter [/FlateDecode /FlateDecode]",
      "/Filter /FlateDecode /Filter /FlateDecode",
      "/Filter [/FlateDecode",
      `/Filter [${"/FlateDecode ".repeat(9)}]`,
      "/Filter /FlateDecode /DecodeParms 9 0 R",
      "/F (external.dat)",
    ]) {
      const packed = bytes(
        `5 0 obj\n<< /Type /ObjStm /N 1 /First 4 ${filter} /Length ${data.length} >>\nstream\n`,
        data,
        "\nendstream\nendobj\n",
      );

      expect(scanPdf(pdf(packed))).toMatchObject({ safe: false, reason: "uninspectable" });
    }

    const truncated = bytes(
      `5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${data.length - 4} >>\nstream\n`,
      data.subarray(0, -4),
      "\nendstream\nendobj\n",
    );

    expect(scanPdf(pdf(truncated))).toMatchObject({ reason: "uninspectable" });
  });

  it("validates object counts, first-byte positions and object offsets", async () => {
    for (const [dict, data] of [
      ["/N 1", "7 0 << /Type /Example >>"],
      ["/N 1 /First 1000", "7 0 << /Type /Example >>"],
      ["/N 2 /First 4", "7 0 << /Type /Example >>"],
      ["/N 1 /First 2", "7 0 << /Type /Example >>"],
      ["/N 1 /First 4", "7 9 << /Type /Example >>"],
      ["/N 2 /First 8", "7 0 7 2 << >> << >>"],
      ["/N 2 /First 8", "7 0 8 0 << >> << >>"],
      ["/N 2 /First 9", "7 0 8 99 << >> << >>"],
      ["/N 1 /First 4", "7 x << /Type /Example >>"],
    ]) {
      expect(
        scanPdf(
          pdf(`5 0 obj\n<< /Type /ObjStm ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`),
        ),
      ).toMatchObject({ reason: "uninspectable" });
    }

    const objects = "7 0 8 6 << >> << /Type /Example >>";

    expect(
      scanPdf(
        pdf(
          `5 0 obj\n<< /Type /ObjStm /N 2 /First 8 /Length ${objects.length} >>\nstream\n${objects}\nendstream\nendobj\n`,
        ),
      ),
    ).toEqual({ safe: true });
  });

  it("shares the expansion budget across all object streams", async () => {
    const objects = `7 0 << /Text (${" ".repeat(MAX_INFLATED_BYTES / 2)}) >>`;
    const first = await objectStream(objects);

    expect(scanPdf(pdf(bytes(first, first)))).toMatchObject({ reason: "uninspectable" });
  });

  it("shares the expansion budget across decoding stages", async () => {
    const twice = await deflate(await deflate(`7 0 << /Text (${" ".repeat(MAX_INFLATED_BYTES - 64)}) >>`));
    const pipeline = bytes(
      `5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter [/FlateDecode /FlateDecode] /Length ${twice.length} >>\nstream\n`,
      twice,
      "\nendstream\nendobj\n",
    );

    expect(scanPdf(pdf(pipeline))).toMatchObject({ reason: "uninspectable" });
  });

  it("can't be fooled by objects inside a fake stream", async () => {
    // No /Length says where this "stream" ends, so its contents are read as objects, as a reader might.
    const fake = "4 0 obj\n<< >>\nstream\n8 0 obj\n<< /S /Launch /F (calc.exe) >>\nendobj\nendstream\nendobj\n";
    expect(scanPdf(pdf(fake))).toMatchObject({ reason: "active", found: ["Launch"] });
    // A /Length that doesn't land on endstream isn't trusted either.
    const wrong = "4 0 obj\n<< /Length 999 >>\nstream\n8 0 obj\n<< /S /Launch >>\nendobj\nendstream\nendobj\n";
    expect(scanPdf(pdf(wrong))).toMatchObject({ reason: "active", found: ["Launch"] });
  });

  it("refuses attachments, encryption, polyglots and broken files", async () => {
    expect(scanPdf(pdf("", "/Names << /EmbeddedFiles 9 0 R >> "))).toMatchObject({
      reason: "attachments",
      found: ["EmbeddedFiles"],
    });
    expect(scanPdf(pdf("", "", "<< /Root 1 0 R /Encrypt 9 0 R >>"))).toMatchObject({
      reason: "encrypted",
    });
    expect(scanPdf(bytes("MZ\x90\0", pdf()))).toMatchObject({ reason: "disguised" });
    expect(scanPdf(bytes(pdf(), "PK\u0005\u0006", "\0".repeat(18)))).toMatchObject({ reason: "disguised" });
    expect(scanPdf(bytes("%PDF-1.7\n<html><script>alert(1)</script>\n1 0 obj\nendobj\n%%EOF"))).toMatchObject({
      reason: "disguised",
    });
    expect(scanPdf(encoder.encode("%PDF-1.7\nnothing here"))).toMatchObject({ reason: "broken" });
  });

  it("reads names the way PDF readers do", () => {
    expect(pdfNames("/Type/Catalog /J#61vaScript/JSON /JS(")).toEqual(["Type", "Catalog", "JavaScript", "JSON", "JS"]);
  });
});
