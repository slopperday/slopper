---
slopper:
  type: feat
---

# Dynamic post text: socialPeople and the {{only}} and {{@key}} syntax

Post text stores `{{only <networks>}}…{{/only}}` and `{{@key}}` (`app/lib/dynamicText.ts`). `destinationFor`, `readiness` and `wordsFor` resolve them per network before spintax and variables, so the composer, the server's save, deliveries, thread parts and first comments agree. The new `socialPeople` table is the address book (studio.people, savePerson, deletePerson). Each post keeps a copy of the people it tags in `socialPosts.people`, so it posts what was checked. The composer edits the text with `@canvist/web/full` (`PostEditor`, `mention` and `conditional`), and its CSP allows `wasm-unsafe-eval`.
