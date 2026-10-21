---
name: Slopper
description: A departures board for launches. Too much slop? Not enough yet!
colors:
  ground: "#f4f5f0"
  sunk: "#e9ebe3"
  raised: "#ffffff"
  ink: "#161a13"
  muted: "#575d50"
  faint: "#7a8072"
  line: "rgb(22 26 19 / 0.12)"
  line-strong: "rgb(22 26 19 / 0.26)"
  board: "#161a13"
  board-ink: "#eef0e8"
  board-muted: "#9aa18f"
  tile: "#262b22"
  tile-top: "#2e3429"
  slop: "#9be22d"
  slop-hover: "#8bd11f"
  slop-deep: "#5f9a12"
  slop-ink: "#10140b"
  slop-text: "#3b6608"
  slop-tint: "rgb(155 226 45 / 0.24)"
  gold: "#ffc21a"
  gold-text: "#8a5f00"
  gold-tint: "rgb(255 194 26 / 0.24)"
  hot: "#c4371b"
  hot-ink: "#ffffff"
  hot-tint: "rgb(196 55 27 / 0.1)"
  focus: "#3b6608"
typography:
  display:
    fontFamily: "Big Shoulders, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "clamp(3.4rem, 8.4vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Big Shoulders, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "clamp(2.75rem, 6vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Big Shoulders, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 2.6rem)"
    fontWeight: 800
    lineHeight: 1
  name:
    fontFamily: "Big Shoulders, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 800
    lineHeight: 1.05
  numeral:
    fontFamily: "Big Shoulders, Arial Narrow, ui-sans-serif, sans-serif"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "'tnum'"
  label:
    fontFamily: "Big Shoulders, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
  lede:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  action:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.1
  meta:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  mono:
    fontFamily: "Atkinson Hyperlegible Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.625
rounded:
  tile: "0.14em"
  sm: "0.375rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  full: "9999px"
spacing:
  gutter: "1rem"
  row: "1rem"
  panel: "1.25rem"
  column-gap: "3.5rem"
  section: "7rem"
components:
  button:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1.15rem"
    height: "2.75rem"
  button-primary:
    backgroundColor: "{colors.slop}"
    textColor: "{colors.slop-ink}"
    typography: "{typography.action}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1.15rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.slop-hover}"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.md}"
  button-gold:
    backgroundColor: "{colors.gold}"
    textColor: "#161a13"
    rounded: "{rounded.md}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "0.5rem 0.75rem"
  button-large:
    height: "3.25rem"
    padding: "0.5rem 1.5rem"
  tag:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.125rem 0.5rem"
  tag-slop:
    backgroundColor: "{colors.slop-tint}"
    textColor: "{colors.ink}"
  tag-gold:
    backgroundColor: "{colors.gold-tint}"
    textColor: "{colors.ink}"
  tag-hot:
    backgroundColor: "{colors.hot}"
    textColor: "{colors.hot-ink}"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.6rem 0.85rem"
    height: "2.75rem"
  panel:
    backgroundColor: "{colors.sunk}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  board:
    backgroundColor: "{colors.board}"
    textColor: "{colors.board-ink}"
    rounded: "{rounded.xl}"
    padding: "1.25rem"
  tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.board-ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.tile}"
    width: "0.78em"
    height: "1.18em"
  tile-urgent:
    backgroundColor: "{colors.hot}"
    textColor: "{colors.hot-ink}"
  vote-pill:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.full}"
    height: "2.75rem"
  vote-up-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.full}"
    size: "2.75rem"
  flash-success:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
  flash-error:
    backgroundColor: "{colors.hot}"
    textColor: "{colors.hot-ink}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
---

# Design System: Slopper

## Overview

**Creative North Star: "The Departures Board"**

Slopper is set like the board in a station hall: today's slops are listed, ranked and timed against midnight, and every
day a maker ships flips a tile to a lime check. The page itself is plain platform-white ground and
confident condensed signage; the one dark, physical object on it is the board, a panel of split-flap tiles that carries
time and days. Everything else stays out of its way.

Density is a list, not a gallery. Launches are rows divided by hairline rules, with a big tabular rank on the left and
the votes on the right, the way departures are read top to bottom. Colour is rationed by meaning: lime is spent only on
shipping, gold only on wins, red only on urgency and danger. Surfaces are flat; tint is the only elevation.

The system refuses the launch-site card grid and the old taped-cards-on-plaster costume. No tilted cards, no drop
shadows, no outlined buttons.

**Key Characteristics:**

- Cool platform-white ground (light) or green-black ground (dark); one deep green-black ink.
- Big Shoulders signage for anything read from across the room; Schibsted Grotesk for anything read up close.
- The board: dark split-flap tiles for clocks and goal days, dark in both themes.
- Lime means shipped, gold means won, red means hurry or danger.
- Rows and hairlines instead of cards; flat tinted panels instead of shadows.
- The seeded splat is the brand: logo, favicon and empty covers. It is never a status; shipped days get a check.

## Colors

A near-neutral green-grey world with three spent accents, each tied to one meaning. Every colour is a CSS custom property
on `:root` in `app/app.css`; dark mode (`prefers-color-scheme: dark`) redefines the same names in place (ground
#121410, ink #eceee6, lime brightens to #b4f23c, hot to #ff6a4d). The full dark map lives in the sidecar. `theme-color`
follows the ground in both schemes.

### Primary

- **Shipping Lime** (slop): the fill for shipped-day marks, the splat, primary buttons, the active nav bar, the
  "now" bar on today's tile, the "Just slopped" dot, the streak strip's shipped segments, and text selection.
- **Lime Hover** (slop-hover): primary button hover only.
- **Wet Edge** (slop-deep): checkbox and radio accent.
- **Lime Text** (slop-text): lime as a text colour on the ground (link hover in the footer, caret). Raw lime is a fill,
  never body text on light ground.
- **Lime Tint** (slop-tint): launch tags and the input focus ring.

### Secondary

- **Win Gold** (gold): slop of the day and slopcessful only: the slopcessful timeline dot, filled stars on the
  slopcessful hall.
- **Gold Text** (gold-text): the winning rank numeral and gold stars on tags.
- **Gold Tint** (gold-tint): "Slop of the day" and "Slopcessful" tags, the slopcessful note panel.

### Tertiary

- **Signal Red** (hot) with **Hot Ink** (hot-ink): the last-hour countdown tiles, NSFW tag, error flashes, field
  errors.
- **Red Tint** (hot-tint): danger zones (delete, moderation) as flat panels.

### Neutral

- **Platform White** (ground): the page.
- **Sunk** (sunk): default buttons, tags, panels, empty states, vote pills, code blocks.
- **Raised** (raised): inputs, the account menu, copyable prompt blocks; the one surface lighter than the ground.
- **Green-Black Ink** (ink): text, the ink button, the active upvote, the success flash.
- **Muted** (muted) and **Faint** (faint): secondary text and captions; faint for unranked numerals and placeholders.
- **Hairline** (line) and **Strong Hairline** (line-strong): row dividers and section rules; input borders and the
  updates timeline rule.
- **Board** (board), **Tile** (tile), **Tile Top** (tile-top), **Board Ink** (board-ink), **Board Muted**
  (board-muted): the board and its split-flap tiles.
- **Focus** (focus): the focus outline; lime-text green in light, full lime in dark.

### Named Rules

**The Shipping Lime Rule.** Lime is spent only on shipping: shipped days, the primary action, "now" and the current
place in navigation. It never decorates a heading, a border or a background panel.

**The Gold Means Won Rule.** Gold appears only for a win (slop of the day, slopcessful). A surface with no winner on it
has no gold.

**The Board Stays Dark Rule.** The board and its tiles are dark in both themes, like the real thing. They never invert
with the page.

**The Token Not Hex Rule.** Components use the custom properties, never literal hexes, so dark mode is a token swap. The
one exception is the gold button's text, which stays #161a13 in both themes because gold stays bright.

## Typography

**Display Font:** Big Shoulders (with Arial Narrow, ui-sans-serif), optical size 10 to 72, weights 600 to 900
**Body Font:** Schibsted Grotesk (with ui-sans-serif, system-ui), weights 400 to 900
**Label/Mono Font:** Atkinson Hyperlegible Mono (with ui-monospace, SFMono-Regular), weights 400 to 700

**Character:** Big Shoulders is condensed station signage, set heavy and tight; Schibsted Grotesk is a sturdy newsroom
grotesk that reads easily at length. The contrast between a sign and a timetable is the whole pairing.

### Hierarchy

- **Display** (900, clamp(3.4rem, 8.4vw, 6rem), 0.9): the hero headline and one closing statement per page at most.
- **Headline** (800, clamp(2.75rem, 6vw, 4.25rem), 0.95): page titles and error titles.
- **Title** (800, clamp(2rem, 3.6vw, 2.6rem), 1): section heads, each with one plain muted line under it.
- **Name** (800, 1.45rem, 1.05): slop names in rows; the leading row in a ranked race sets its name at 1.9rem to 2.25rem.
- **Numeral** (800 to 900, tabular figures, 1): ranks, counts, votes, goal totals and every tile glyph.
- **Label** (700, 0.95rem, 0.06em tracking, uppercase, muted): board captions and column headings ("Just slopped",
  "Share it", footer columns, update kinds).
- **Lede** (400, 1.1875rem, 1.55, max 36rem, muted): the one paragraph under a page title.
- **Body** (400, 1.0625rem, 1.6): everything read up close; maker Markdown at 1.65 and capped near 68ch.
- **Action** (700, 1rem, 1.1): buttons, nav links, menu items and inline links.
- **Meta** (400, 0.875rem, muted): bylines, times, counts in rows, hints.
- **Mono** (400, 0.8125rem): code blocks, API tokens, slugs, URL fields and launch numbers (#0004).

### Named Rules

**The Signage Rule.** Big Shoulders sets anything read from across the room (headings, names, ranks, counts, tiles,
captions). Schibsted Grotesk sets everything read up close. Mono is only for code and data codes, never for labels or
headings.

**The Tabular Rule.** Every number that can change (ranks, votes, clocks, goal counts) uses tabular figures so the
board never shifts as it updates.

## Layout

One centred column, max 72rem wide (max-w-6xl) with a 1rem gutter; reading pages narrow to 42rem to 56rem. Home sections
stand 7rem apart, and the footer sits 8rem below the last section. Two-column views split at `lg` with a 3.5rem column
gap: the race beside a 21rem rail, or 1.35fr beside 1fr.

The first viewport sets the headline across the full width, then splits lede and actions (1fr) against the sample goal
board (1.15fr) at `lg`; below that it stacks, with the two actions side by side on phones. Lists are rows: each row pads
1rem (1.25rem from `sm`), rows are divided by `line` hairlines, and the list is closed top and bottom by the same rule.

The goal board lays out its days with container queries: 6 columns, 10 from a 30rem container, 15 from 56rem. The
header is 4rem tall; below `md` the nav drops to a second 2.75rem row that scrolls sideways, and the clock joins the
header at `lg`. Nothing scrolls horizontally at 375px, and every interactive target is at least 2.75rem (44px).

## Elevation & Depth

Flat by default. Depth comes from three things only: the sunk tint for grouped controls, the dark board, and hairline
rules between rows. The header is the ground at 90% with a 12px backdrop blur and a bottom hairline. Focus is a 2px
`focus` outline offset 3px; inputs instead take a `focus` border with a 3px `slop-tint` ring, which is a focus
indicator, not elevation.

### Shadow Vocabulary

- **Popover** (`box-shadow: 0 18px 40px -16px rgb(0 0 0 / 0.45)`): the account menu, the only element that floats over
  the page.

### Named Rules

**The Tint Is Elevation Rule.** A grouped area is a flat `sunk` panel. If it needs to stand out more, it becomes the
board or takes a tint (gold, red), never a shadow. The popover is the single exception.

## Shapes

Soft rectangles with a small radius ladder: tile corners at 0.14em of the tile's own size, tags and day cells at
0.375rem, buttons, inputs, covers and flashes at 0.75rem, panels, empty states and the menu at 1rem, the board at
1.25rem. Pills (fully round) are kept for the vote control, avatars, status dots and the caps on nav bars.

The split-flap tile is the recurring silhouette: 0.78em by 1.18em, two halves (`tile-top` over `tile`) with a 1px dark
split across the middle, sitting behind the glyph so small tiles stay legible. Goal-day cells use the same tile at a
4:5 ratio. The seeded splat is the one organic shape, kept for the brand: the logo, the favicon and covers with no screenshot.

## Components

### Buttons

Solid, plain, confident: one shape, no outline, no shadow.

- **Shape:** gently rounded (0.75rem), 2.75rem tall, bold 1rem label, icon gap 0.5rem.
- **Primary:** lime fill with near-black lime ink; one per view, for the shipping action ("New slop", "Start slopping",
  "Throw today's slop", "Try it").
- **Default:** sunk fill; hover mixes 9% ink into it. Used for secondary actions and "see more" links with a right
  arrow.
- **Ink:** ink fill on ground text, for strong actions that are not shipping (sign in, post feedback, pledge, connect)
  and the skip link. **Quiet:** transparent with tighter padding, sunk on
  hover, for remove and disconnect actions, usually in muted text.
- **Sizes:** small (0.9rem inline padding, 0.9375rem text) in the header and section heads; large (3.25rem tall, 1.5rem
  padding, 1.0625rem text) for a page's main action, often only from `sm` up.
- **States:** 140ms colour transitions, a 1px press-down on active, 50% opacity when disabled.

### Chips (Tags)

- **Style:** tinted, never outlined: 0.375rem radius, bold 0.8125rem, sunk by default.
- **Variants:** lime tint for launch labels, gold tint for slop of the day and slopcessful (with a filled gold star),
  solid red for NSFW.

### Cards / Containers

- **Panel:** flat sunk area, 1rem radius, 1.25rem padding (up to 2.5rem for a page-level prompt).
- **Empty state:** a sunk panel, centred, muted text, 3rem vertical padding; may lead with one Big Shoulders 2.75rem line
  in ink ("Blank wall.") and one primary action.
- **Flash:** full-width bar at 0.75rem radius in sunk (info), ink (success) or red (error).
- **Danger zone:** red-tint panel at 1rem radius.

### Inputs / Fields

- **Style:** raised fill, 1px `line-strong` border, 0.75rem radius, 2.75rem tall; textareas start at 7rem. Selects draw
  their own small chevron in muted.
- **Focus:** border turns `focus` with a 3px lime-tint ring.
- **Labels and messages:** bold 0.9375rem label above; muted 0.875rem hint or bold red 0.875rem error below.

### Navigation

- **Header:** the splat-and-"slopper" lockup on the left, plain bold links (0.9375rem) in muted that turn ink on hover, the labelled
  board-tile clock and the primary action on the right, avatar menu last.
- **Active:** the current link sits on a 3px lime bar flush with the header's bottom edge, rounded on top. Settings tabs
  use the same bar.
- **Mobile:** links move to a second row that scrolls sideways; the "New slop" label hides below 360px, leaving the
  plus icon.
- **Footer:** lockup at 2.75rem, a muted line, caps column heads, bold links that turn lime-text on hover.

### The Board (signature)

- **Tiles:** one character per split-flap tile in Big Shoulders 800 with tabular figures; separators (`:` `/` `.`) sit
  between tiles at 60% opacity. Tiles are hidden from screen readers; the same value is always given as text.
- **Clock:** time left to midnight in hours and minutes, always beside a muted bold label naming its zone ("left in your
  day", "to midnight UTC"). In the last hour it switches to minutes and seconds and the tiles turn red.
- **Goal board:** the dark board (1.25rem padding, 1.75rem from `sm`) with the goal title, a big "shipped/target" count
  with a caps "slopped" caption, the grid of days, and a muted footer (streak, end date). Day states: shipped flips to
  a lime check (the drawn icon; a small "×2" in the corner for more than one launch) and lifts 2px on hover; today shows its number over a 3px
  pulsing lime "now" bar; missed is a dimmed tile with a small dot; upcoming is an empty cell with a faint hairline and a
  muted number.
- **Motion:** once the page is live, a changed glyph drops into place with a 340ms flap (`cubic-bezier(0.2, 0.7, 0.2,
  1)`), staggered 45ms per tile; never in server markup. The "now" bar breathes on a 2.4s cycle and is the only looping
  motion. Reduced motion collapses all of it.

### Slop Rows

- **Structure:** rank numeral (faint 1.9rem; the leader 2.5rem in ink; a winner in gold-text), a square cover (3.5rem
  to 5rem, 0.75rem radius; a board tile with the splat when there is no screenshot), the name, tags, a two-line muted
  tagline, a meta line (maker, goal day, time, activity, platforms) and the vote pill on the right.
- **Behaviour:** the whole row is one link stretched from the name; the name underlines (2px) on row hover. The maker
  link and votes sit above the stretched link.

### Vote Pill

- **Style:** a sunk pill with 2.75rem round buttons (3rem on the slop page) and a Big Shoulders count between them.
- **States:** an active upvote fills ink; an active downvote fills muted; hover tints the button with `line`. Only
  upvotes are ever counted on screen.

### Ticker, Timeline and Run Strip

- **Just slopped:** a hairline-ruled strip with a caps label and an 8px lime dot, scrolling sideways like the next
  departures.
- **Updates timeline:** a 1px `line-strong` rule with 9px dots: lime for a launch, gold for slopcessful, ink for the
  rest; caps kind labels.
- **Run strip:** an 8px rounded strip of day segments: lime shipped, ink at 35% today, red at 45% missed, strong hairline
  upcoming.

### Brand Mark and Icons

- **Lockup:** the seeded splat at 1.05em, then "slopper" in Big Shoulders 900, 0.22em apart and centred. The splat is
  drawn twice: an `ink` copy nudged down and right (`board-ink` on the dark board), the `slop` face on top. Its
  droplets are part of the paths.
- **Favicon:** the splat on a transparent ground, lime over ink; in dark mode the ink copy turns light.
- **Icons:** a small drawn set (arrows, bell, star, check, close, plus, out) on one 24px grid with a 2px round stroke in
  `currentColor`; the star fills for wins.

## Do's and Don'ts

### Do:

- **Do** spend lime only on shipping: shipped days, the one primary action, "now" and the active nav bar.
- **Do** keep gold for wins and red for the last hour, NSFW, errors and destructive zones.
- **Do** put clocks, goal days and short codes on board tiles, label every clock with its zone, and give screen readers
  the value as text.
- **Do** set lists as rows divided by `line` hairlines, with tabular ranks and counts in Big Shoulders.
- **Do** use a flat `sunk` panel to group controls, and `slop-text` (not raw lime) when lime has to be text on the
  ground.
- **Do** keep every target at least 2.75rem (44px) and respect reduced motion.

### Don't:

- **Don't** lay launches out as a card grid or as taped, tilted cards on a textured wall.
- **Don't** add drop shadows; the account menu popover is the only one.
- **Don't** outline buttons or tags; they are solid fills or tints.
- **Don't** invert the board or its tiles to light in the light theme.
- **Don't** use Atkinson Hyperlegible Mono for labels, headings or numbers that are not code or data codes.
- **Don't** use emoji as icons or decoration; the drawn icon set and the splat carry every glyph.
- **Don't** use kitchen, cooking, restaurant or food imagery anywhere.
