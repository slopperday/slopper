import { describe, expect, it } from "vite-plus/test";
import { decodeEntities, MAX_UNPACKED_BYTES, scanEpub, sniffEpub, startTags } from "~/.server/epubSafety";
import { CONTAINER, epub, epubEntries, zip } from "./epubs";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

/** Change real package metadata while preserving the ZIP's integrity. */
function editPackage(edit: (xml: string) => string): Uint8Array<ArrayBuffer> {
  return zip(
    epubEntries().map((entry) =>
      entry.name.endsWith(".opf") && typeof entry.data === "string" ? { ...entry, data: edit(entry.data) } : entry,
    ),
  );
}

describe("EPUB safety scan", () => {
  it.each(["png", "txt", "css"])("refuses a spine document disguised as .%s", (extension) => {
    const book = zip(
      epubEntries({ body: "<script>alert(1)</script>" }).map((entry) => ({
        ...entry,
        name: entry.name.replace("chapter1.xhtml", `chapter1.${extension}`),
        data:
          typeof entry.data === "string"
            ? entry.data.replaceAll("chapter1.xhtml", `chapter1.${extension}`)
            : entry.data,
      })),
    );
    expect(scanEpub(book)).toMatchObject({ safe: false });
  });

  it.each([
    ["CSS declared SVG", 'media-type="text/css"', 'media-type="image/svg+xml"'],
    ["CSS declared script", 'media-type="text/css"', 'media-type="application/javascript"'],
    ["XHTML declared plain text", 'media-type="application/xhtml+xml"', 'media-type="text/plain"'],
    ["missing resource", 'href="chapter1.xhtml"', 'href="missing.xhtml"'],
    ["remote resource", 'href="chapter1.xhtml"', 'href="https://evil.example/chapter.xhtml"'],
    ["escaping resource", 'href="chapter1.xhtml"', 'href="../../chapter.xhtml"'],
    ["ambiguous resource", 'href="chapter1.xhtml"', 'href="chapter1.xhtml?type=html"'],
    ["double-encoded resource", 'href="chapter1.xhtml"', 'href="%2563hapter1.xhtml"'],
    ["invalid encoded path", 'href="chapter1.xhtml"', 'href="%xx.xhtml"'],
    ["ambiguous id", 'id="ch1"', 'id="ch1 "'],
    ["duplicate id", 'id="ch1"', 'id="nav"'],
    ["duplicate attribute", 'id="ch1"', 'id="ch1" id="other"'],
    ["fallback", 'id="ch1"', 'id="ch1" fallback="nav"'],
    ["media overlay", 'id="ch1"', 'id="ch1" media-overlay="nav"'],
    ["base override", "<manifest>", '<manifest xml:base="https://evil.example/">'],
    ["missing spine reference", 'idref="ch1"', 'idref="missing"'],
    ["inert spine resource", 'idref="ch1"', 'idref="css"'],
    ["inert navigation document", 'id="css"', 'id="css" properties="nav"'],
    ["inert NCX navigation", "<spine>", '<spine toc="css">'],
    ["missing NCX navigation", "<spine>", '<spine toc="missing">'],
    ["malformed XML", "</manifest>", "</other>"],
    ["missing manifest", "<manifest>", "<other>"],
    ["empty spine", '<itemref idref="ch1"/>', ""],
    [
      "misplaced declaration",
      "</metadata>",
      '<item id="hidden" href="chapter1.xhtml" media-type="text/plain"/></metadata>',
    ],
    ["nested manifest", "</metadata>", "<manifest/></metadata>"],
    ["long metadata name", "</metadata>", `<${"n".repeat(1025)}/></metadata>`],
    [
      "long ancestry",
      "</metadata>",
      `${`<${"n".repeat(100)}>`.repeat(12)}${`</${"n".repeat(100)}>`.repeat(12)}</metadata>`,
    ],
    ["deep metadata", "<manifest>", `${"<group>".repeat(65)}${"</group>".repeat(65)}<manifest>`],
    [
      "duplicate path",
      "</manifest>",
      '<item id="alias" href="./%63hapter1.xhtml" media-type="application/xhtml+xml"/></manifest>',
    ],
  ])("refuses ambiguous package semantics: %s", (_label, before, after) => {
    expect(scanEpub(editPackage((xml) => xml.replace(before, after)))).toMatchObject({ safe: false });
  });

  it.each([
    CONTAINER.replace("content.opf", "missing.opf"),
    CONTAINER.replace("application/oebps-package+xml", "text/plain"),
    CONTAINER.replace(
      "</rootfiles>",
      '<rootfile full-path="other.opf" media-type="application/oebps-package+xml"/></rootfiles>',
    ),
    CONTAINER.replace("full-path=", 'xml:base="https://evil.example/" full-path='),
    CONTAINER.replace("</rootfiles>", "</other>"),
    CONTAINER.replace("</rootfiles>", '<group><rootfile full-path="hidden.opf"/></group></rootfiles>'),
    CONTAINER.replace("urn:oasis:names:tc:opendocument:xmlns:container", "https://evil.example/ns"),
  ])("refuses an ambiguous or missing package selected by container.xml", (container) => {
    const book = zip(
      epubEntries().map((entry) => (entry.name === "META-INF/container.xml" ? { ...entry, data: container } : entry)),
    );
    expect(scanEpub(book)).toMatchObject({ safe: false });
  });

  it("resolves local encoded paths, XML character references and namespace prefixes", () => {
    const book = editPackage((xml) =>
      xml
        .replace('href="chapter1.xhtml"', 'href="./%63hapter1.xhtml"')
        .replace('media-type="application/xhtml+xml"', 'media-type="application/xhtml&#x2b;xml"')
        .replace('xmlns="http://www.idpf.org/2007/opf"', 'xmlns:p="http://www.idpf.org/2007/opf"')
        .replace(/<(\/?)(package|metadata|manifest|item|spine|itemref)(?=[\s/>])/g, "<$1p:$2"),
    );
    expect(scanEpub(book)).toMatchObject({ safe: true });
  });

  it("accepts legacy NCX navigation when the spine selects a declared NCX resource", () => {
    const book = zip(
      epubEntries({
        files: [
          {
            name: "OEBPS/toc.ncx",
            data: '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>A zine</text></docTitle><navMap><navPoint id="one" playOrder="1"><navLabel><text>One</text></navLabel><content src="chapter1.xhtml"/></navPoint></navMap></ncx>',
          },
        ],
      }).map((entry) =>
        entry.name.endsWith(".opf") && typeof entry.data === "string"
          ? {
              ...entry,
              data: entry.data
                .replace(
                  "</manifest>",
                  '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>',
                )
                .replace("<spine>", '<spine toc="ncx">'),
            }
          : entry,
      ),
    );
    expect(scanEpub(book)).toMatchObject({ safe: true });
  });

  it("passes a plain book with images, fonts, web links and obfuscated fonts, and reads out its text", () => {
    const book = epub({
      body: `<h1>Ship it</h1><p>Read &amp; <a href="https://slopper.day">try</a> it. <img src="cover.png" alt="JavaScript: a cover"/></p><p><a href="javascript-guide.xhtml">Next</a> <a href="file1.xhtml">Notes</a></p>`,
      files: [
        { name: "OEBPS/cover.png", data: PNG, store: true },
        { name: "OEBPS/font.otf", data: new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 1, 2, 3]) },
        {
          name: "META-INF/encryption.xml",
          data: `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/font.otf"/></enc:CipherData></enc:EncryptedData></encryption>`,
        },
      ],
    });
    expect(sniffEpub(book)).toBe(true);
    const verdict = scanEpub(book);
    expect(verdict).toMatchObject({ safe: true });
    expect(verdict.safe && verdict.text).toContain("Ship it Read & try it.");
  });

  it("refuses scripts, event handlers, frames, forms and code links, however they're spelled", () => {
    const cases: [string, string][] = [
      ["<script>alert(1)</script>", "script"],
      ['<p onclick="alert(1)">x</p>', "onclick"],
      ['<a href="jav&#x61;script:alert(1)">x</a>', "href=javascript:alert(1)"],
      ['<a href=" java\tscript:alert(1)">x</a>', "href=javascript:alert(1)"],
      ['<a xlink:href="vbscript:x">x</a>', "xlink:href=vbscript:x"],
      ['<iframe src="chapter1.xhtml"></iframe>', "iframe"],
      ['<form action="https://evil.example"><input name="password"/></form>', "form"],
      ["<svg:svg><svg:script>alert(1)</svg:script></svg:svg>", "script"],
      // A `>` inside a quoted value doesn't end the tag, for us or for a reader.
      ['<img alt=">" src="cover.png" onerror="alert(1)"/>', "onerror"],
      // CDATA is a comment in HTML, so what's inside is read as markup.
      ['<![CDATA[ > <img src="x" onerror="alert(1)"/> ]]>', "onerror"],
      ['<object data="data:text/html,hi"></object>', "object"],
    ];
    for (const [body, found] of cases) {
      expect(scanEpub(epub({ body })), body).toEqual({ safe: false, reason: "active", found: [found] });
    }
    expect(
      scanEpub(epub({ head: '<meta http-equiv="refresh" content="0; url=https://evil.example"/>' })),
    ).toMatchObject({ reason: "active", found: ["meta refresh"] });
    expect(scanEpub(epub({ properties: "scripted" }))).toMatchObject({ reason: "active", found: ["scripted"] });
    expect(scanEpub(epub({ files: [{ name: "OEBPS/app.js", data: "alert(1)" }] }))).toMatchObject({
      reason: "active",
      found: ["OEBPS/app.js"],
    });
    expect(
      scanEpub(epub({ files: [{ name: "OEBPS/art.svg", data: '<svg><a href="javascript:x"><circle/></a></svg>' }] })),
    ).toMatchObject({ reason: "active" });
    expect(scanEpub(epub({ body: '<p style="width: expression(alert(1))">x</p>' }))).toMatchObject({
      reason: "active",
      found: ["CSS"],
    });
    expect(
      scanEpub(epub({ files: [{ name: "OEBPS/more.css", data: "p { background: url(\\6a avascript:x) }" }] })),
    ).toMatchObject({ reason: "active", found: ["CSS"] });
  });

  it("refuses books that load things from the web when they're opened", () => {
    expect(scanEpub(epub({ body: '<img src="https://tracker.example/pixel.gif"/>' }))).toMatchObject({
      reason: "remote",
      found: ["img src"],
    });
    expect(scanEpub(epub({ head: '<link rel="stylesheet" href="//cdn.example/x.css"/>' }))).toMatchObject({
      reason: "remote",
    });
    expect(scanEpub(epub({ body: "<style>@import 'https://cdn.example/x.css';</style>" }))).toMatchObject({
      reason: "remote",
      found: ["CSS"],
    });
    expect(
      scanEpub(epub({ files: [{ name: "OEBPS/more.css", data: "p { background: url('https://x.example/a.png') }" }] })),
    ).toMatchObject({ reason: "remote" });
    expect(scanEpub(epub({ properties: "remote-resources" }))).toMatchObject({ reason: "remote" });
  });

  it("refuses ZIP tricks: bombs, wrong sizes, climbing names, twins and anything stuck on", () => {
    const bomb = epub({ files: [{ name: "OEBPS/big.txt", data: new Uint8Array(MAX_UNPACKED_BYTES + 1) }] });
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect(scanEpub(bomb)).toMatchObject({ reason: "uninspectable" });

    const lies = epub(
      {},
      { directory: (entry, record) => entry.name.endsWith("css") && record.setUint32(24, 1, true) },
    );
    expect(scanEpub(lies)).toMatchObject({ reason: "broken", found: ["OEBPS/style.css"] });
    const crc = epub({}, { directory: (entry, record) => entry.name.endsWith("css") && record.setUint32(16, 7, true) });
    expect(scanEpub(crc)).toMatchObject({ reason: "broken" });

    expect(scanEpub(epub({ files: [{ name: "../../evil.xhtml", data: "<p/>" }] }))).toMatchObject({
      reason: "disguised",
      found: ["../../evil.xhtml"],
    });
    expect(scanEpub(epub({ files: [{ name: "OEBPS/Style.CSS", data: "p {}" }] }))).toMatchObject({
      reason: "disguised",
    });
    expect(scanEpub(epub({}, { after: new TextEncoder().encode("MZ, a program stuck on the end") }))).toMatchObject({
      reason: "disguised",
    });
    expect(scanEpub(epub({}, { before: new TextEncoder().encode("%PDF-1.7\n") }))).toMatchObject({ reason: "broken" });
    const plain = epub();
    const polyglot = zip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "a.txt", data: "%PDF-1.7 hello", store: true },
      ...epubEntries().slice(1),
    ]);
    expect(scanEpub(plain)).toMatchObject({ safe: true });
    expect(scanEpub(polyglot)).toMatchObject({ reason: "disguised", found: ["PDF"] });

    const notFirst = zip([epubEntries()[1], epubEntries()[0], ...epubEntries().slice(2)]);
    expect(sniffEpub(notFirst)).toBe(false);
    expect(scanEpub(notFirst)).toMatchObject({ reason: "broken" });
    const bzip = epub(
      {},
      { directory: (entry, record) => entry.name.endsWith("css") && record.setUint16(10, 12, true) },
    );
    expect(scanEpub(bzip)).toMatchObject({ reason: "uninspectable" });
  });

  it("refuses DRM, encrypted entries, programs, odd files and entity tricks", () => {
    const drm = `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`;
    expect(scanEpub(epub({ files: [{ name: "META-INF/encryption.xml", data: drm }] }))).toMatchObject({
      reason: "encrypted",
    });
    expect(scanEpub(epub({ files: [{ name: "META-INF/rights.xml", data: "<rights/>" }] }))).toMatchObject({
      reason: "encrypted",
    });
    const locked = epub(
      {},
      { directory: (entry, record) => entry.name.endsWith("css") && record.setUint16(8, 1, true) },
    );
    expect(scanEpub(locked)).toMatchObject({ reason: "encrypted" });

    const program = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    expect(scanEpub(epub({ files: [{ name: "OEBPS/cover.png", data: program }] }))).toMatchObject({
      reason: "disguised",
      found: ["OEBPS/cover.png"],
    });
    expect(scanEpub(epub({ files: [{ name: "OEBPS/setup.exe", data: program }] }))).toMatchObject({
      reason: "attachments",
      found: ["OEBPS/setup.exe"],
    });
    const laughs = '<!DOCTYPE html [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><html><body>&lol2;</body></html>';
    expect(scanEpub(epub({ files: [{ name: "OEBPS/lol.xhtml", data: laughs }] }))).toMatchObject({
      reason: "uninspectable",
    });
    expect(scanEpub(new TextEncoder().encode("PK\u0003\u0004 not really"))).toMatchObject({ safe: false });
  });

  it("reads tags and character references the way readers do", () => {
    expect(startTags(`<a href='x>y' title="t"/> text > <b>`)).toEqual([
      {
        name: "a",
        attributes: [
          ["href", "x>y"],
          ["title", "t"],
        ],
      },
      { name: "b", attributes: [] },
    ]);
    expect(decodeEntities("&#106;&#x61;v&Tab;a&colon;&amp;&bogus;")).toBe("jav\ta:&&bogus;");
  });
});
