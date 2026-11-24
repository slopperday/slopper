---
slopper:
  type: feat
---

# Ship Big Shoulders cut to weights 700 to 900

app/fonts holds Big Shoulders' three subsets instanced to wght 700:900 with fontTools (opsz kept, since its optical size follows the font size). The site never sets it lighter than 700; the one exception, the product page fields' '+' toggle, now draws at 700. Latin drops from 58 KB to 37 KB, and it's preloaded on every page.
