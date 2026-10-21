---
slopper: feat
---

# Publications (PDFs) on slops

- `slops.publication` and `scheduledLaunches.publication` hold one PDF's media id; media rows keep a `fileName`. `PublicSlop.publication` is `{ url, fileName, size }` or null, and cards show "PDF" beside the platforms.
- `scanPdf` (app/.server/pdfSafety.ts) is a pdfid-style safety scan run before anything else: it undoes `#xx` name escapes, inflates object streams (capped at `MAX_INFLATED_BYTES` against bombs), skips stream data only where `/Length` lands on `endstream`, and refuses polyglots, encryption, active content (`/JavaScript`, `/Launch`, `/SubmitForm`, `/XFA`, script URIs…), attachments and object streams it can't read. The reason maps to a message in `PDF_PROBLEMS`.
- `uploadPublication` (app/.server/media.ts) sniffs `%PDF-`, caps at `LIMITS.publicationBytes`, runs `scanPdf`, and runs the content check with the PDF inline as a `file` part and OpenRouter's free `pdf-text` parser. Blocked ones are refused, mature ones blur the slop through `checkScreenshots`, and an unchecked one is sent again with the launch check.
- `validateSlop` takes a link or a publication. Screenshots only take images now (`isImage`), and `releaseMedia` counts publications as shown.
- Agents: the `upload_publication` operation, `POST /api/v1/publications` (raw PDF with `?fileName=`, or JSON), and `publication` on `create_slop`/`update_slop` (null takes it off).
