---
slopper: feat
---

# Publications (PDFs) on slops

- `slops.publication` and `scheduledLaunches.publication` hold one PDF's media id; media rows keep a `fileName`. `PublicSlop.publication` is `{ url, fileName, size }` or null, and cards show "PDF" beside the platforms.
- `uploadPublication` (app/.server/media.ts) sniffs `%PDF-`, caps at `LIMITS.publicationBytes`, and runs the content check with the PDF inline as a `file` part and OpenRouter's free `pdf-text` parser. Blocked ones are refused, mature ones blur the slop through `checkScreenshots`, and an unchecked one is sent again with the launch check.
- `validateSlop` takes a link or a publication. Screenshots only take images now (`isImage`), and `releaseMedia` counts publications as shown.
- Agents: the `upload_publication` operation, `POST /api/v1/publications` (raw PDF with `?fileName=`, or JSON), and `publication` on `create_slop`/`update_slop` (null takes it off).
