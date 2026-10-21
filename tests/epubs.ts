import { crc32, deflateRawSync } from "node:zlib";

/** EPUBs for tests, zipped by hand so a test can bend any part of the archive. */

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
  /** Stored as it is instead of deflated (the mimetype always is). */
  store?: boolean;
}

export interface ZipOptions {
  /** Bytes before the first entry, or after the end record. */
  before?: Uint8Array;
  after?: Uint8Array;
  /** Changes an entry's central directory record after it's written. */
  directory?: (entry: ZipEntry, record: DataView) => void;
}

const encoder = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** A plain ZIP of `entries`, in order. */
export function zip(entries: ZipEntry[], { before, after, directory }: ZipOptions = {}): Uint8Array<ArrayBuffer> {
  const locals: Uint8Array[] = before ? [before] : [];
  const centrals: Uint8Array[] = [];
  let offset = before?.byteLength ?? 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const store = entry.store || entry.name === "mimetype";
    const packed = store ? data : new Uint8Array(deflateRawSync(data));
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, store ? 0 : 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    locals.push(new Uint8Array(local.buffer), name, packed);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(10, store ? 0 : 8, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, packed.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);
    directory?.(entry, central);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.byteLength + packed.byteLength;
  }
  const centralBytes = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralBytes.byteLength, true);
  end.setUint32(16, offset, true);
  return concat([...locals, centralBytes, new Uint8Array(end.buffer), ...(after ? [after] : [])]);
}

export interface EpubParts {
  /** The chapter's body, as XHTML. */
  body?: string;
  /** More for the chapter's head. */
  head?: string;
  /** More entries, after the book's own. */
  files?: ZipEntry[];
  /** Properties on the chapter's manifest item, like "scripted". */
  properties?: string;
}

export const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

/** The entries of a one-chapter EPUB 3, as Pages, Calibre or Sigil would write it. */
export function epubEntries({ body = "<p>Hello</p>", head = "", files = [], properties }: EpubParts = {}): ZipEntry[] {
  const item = properties ? ` properties="${properties}"` : "";
  return [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: CONTAINER },
    {
      name: "OEBPS/content.opf",
      data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:1</dc:identifier><dc:title>A zine</dc:title><dc:language>en</dc:language></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"${item}/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
    },
    {
      name: "OEBPS/nav.xhtml",
      data: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">One</a></li></ol></nav></body></html>`,
    },
    {
      name: "OEBPS/chapter1.xhtml",
      data: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title><link rel="stylesheet" href="style.css"/>${head}</head>
<body>${body}</body></html>`,
    },
    { name: "OEBPS/style.css", data: "body { font-family: serif; } h1 { color: #333; }" },
    ...files,
  ];
}

/** A one-chapter EPUB 3 that the safety scan passes, unless a test adds something it shouldn't. */
export function epub(parts: EpubParts = {}, options: ZipOptions = {}): Uint8Array<ArrayBuffer> {
  return zip(epubEntries(parts), options);
}
