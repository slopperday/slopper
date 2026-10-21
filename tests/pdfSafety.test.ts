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

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([encoder.encode(text)]).stream().pipeThrough(new CompressionStream("deflate"));
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
  it("passes a plain PDF, links, pages that open at a view, and binary stream data", async () => {
    expect(scanPdf(pdf())).toEqual({ safe: true });
    expect(
      scanPdf(
        pdf(
          "3 0 obj\n<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://slopper.day) >> >>\nendobj\n",
          "/OpenAction [3 0 R /Fit] ",
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
      found: ["JavaScript", "JS"],
    });
    expect(scanPdf(pdf("", "/AA << /O << /S /J#61vaScript /J#53 (x) >> >> "))).toMatchObject({
      reason: "active",
      found: ["JavaScript", "JS"],
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
