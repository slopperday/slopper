---
slopper: feat
---

# Publications (PDFs and EPUBs) on slops

- `slops.publication` and `scheduledLaunches.publication` hold one PDF's media id; media rows keep a `fileName`. `PublicSlop.publication` is `{ url, fileName, size }` or null, and cards show "PDF" beside the platforms.
- `scanPdf` (app/.server/pdfSafety.ts) is a pdfid-style safety scan run before anything else: it undoes `#xx` name escapes, inflates object streams (capped at `MAX_INFLATED_BYTES` against bombs), skips stream data only where `/Length` lands on `endstream`, and refuses polyglots, encryption, active content (`/JavaScript`, `/Launch`, `/SubmitForm`, `/XFA`, script URIs…), attachments and object streams it can't read. The reason maps to a message in `PDF_PROBLEMS`.
- `scanEpub` (app/.server/epubSafety.ts) is the EPUB side: it reads the ZIP's directory and requires its entries to sit end to end with nothing around them, unpacks each (capped at `MAX_UNPACKED_BYTES`) and checks its size and CRC, refuses climbing or twin names, ZIP64, encrypted entries and DRM (font obfuscation is fine), only lets in the files a book is made of, and reads every page, drawing and stylesheet with a quote-aware tag reader: scripts, frames, forms, `on*` handlers, code URLs (after undoing character references and CSS escapes) and anything that loads from the web are refused. It returns the book's text, which the content check reads as a text part instead of a file part. `EPUB_PROBLEMS` holds the messages.
- Publications are `PUBLICATION_TYPES.pdf` or `.epub` (`publicationFormat` in convex/lib/media.ts), stored under `publications/` with their own extension; `PublicPublication` and the form's publication carry `format`, and upload results return it.
- `uploadPublication` (app/.server/media.ts) sniffs an EPUB's leading `mimetype` entry or `%PDF-`, caps at `LIMITS.publicationBytes`, runs `scanPdf`, and runs the content check with the PDF inline as a `file` part and OpenRouter's free `pdf-text` parser. Blocked ones are refused, mature ones blur the slop through `checkScreenshots`, and an unchecked one is sent again with the launch check.
- `validateSlop` takes a link or a publication. Screenshots only take images now (`isImage`), and `releaseMedia` counts publications as shown.
- Agents: the `upload_publication` operation, `POST /api/v1/publications` (raw PDF with `?fileName=`, or JSON), and `publication` on `create_slop`/`update_slop` (null takes it off).
