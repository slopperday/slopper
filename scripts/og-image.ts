/**
 * Draws public/og.png: the 1200×630 card shown when a link to Slopper is
 * shared (slop pages use their first screenshot instead; see app/lib/seo.ts).
 *
 * The card is the homepage hero in miniature: the headline over a goal board
 * whose shipped days have flipped to lime checks. It's rendered in headless
 * Chromium with the site's own fonts and colours (DESIGN.md), so rerun it
 * after either changes.
 *
 *   node scripts/og-image.ts
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUTPUT = join(ROOT, "public", "og.png");
const WIDTH = 1200;
const HEIGHT = 630;

function dataUrl(path: string, type: string): string {
  return `data:${type};base64,${readFileSync(join(ROOT, path)).toString("base64")}`;
}

const FONTS = {
  display: dataUrl(
    "node_modules/@fontsource-variable/big-shoulders/files/big-shoulders-latin-standard-normal.woff2",
    "font/woff2",
  ),
  sans: dataUrl(
    "node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2",
    "font/woff2",
  ),
};
const LOGO = dataUrl("public/favicon.svg", "image/svg+xml");
/** The site's check icon, a touch heavier so it survives a thumbnail. */
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;

/** A sample run: three days shipped, today waiting, three to go. */
const DAYS = [1, 2, 3, 4, 5, 6, 7].map((day) => {
  if (day < 4) return `<li class="day tile shipped">${CHECK}</li>`;
  if (day === 4) return `<li class="day tile today"><span>${day}</span></li>`;
  return `<li class="day upcoming">${day}</li>`;
});

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: "Big Shoulders"; font-weight: 100 900; src: url(${FONTS.display}) format("woff2"); }
  @font-face { font-family: "Schibsted Grotesk"; font-weight: 400 900; src: url(${FONTS.sans}) format("woff2"); }
  :root {
    --ground: #f4f5f0;
    --ink: #161a13;
    --muted: #575d50;
    --board: #161a13;
    --board-ink: #eef0e8;
    --board-muted: #9aa18f;
    --tile: #262b22;
    --tile-top: #2e3429;
    --slop: #9be22d;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    display: flex;
    flex-direction: column;
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    padding: 56px 72px 64px;
    background: var(--ground);
    color: var(--ink);
    font-family: "Schibsted Grotesk", sans-serif;
  }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 14px; font: 900 54px/1 "Big Shoulders", sans-serif; }
  .brand img { height: 58px; }
  .url { font-size: 26px; font-weight: 600; color: var(--muted); }
  h1 {
    margin-top: auto;
    font: 900 118px/0.9 "Big Shoulders", sans-serif;
    letter-spacing: -0.01em;
  }
  .board {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 40px;
    padding: 28px 32px;
    border-radius: 24px;
    background: var(--board);
    color: var(--board-ink);
  }
  .goal h2 { font: 800 46px/1 "Big Shoulders", sans-serif; }
  .goal p { margin-top: 10px; font-size: 22px; color: var(--board-muted); }
  .days { display: flex; gap: 10px; list-style: none; }
  .day {
    position: relative;
    display: grid;
    place-items: center;
    width: 64px;
    height: 80px;
    border-radius: 9px;
    font: 800 32px/1 "Big Shoulders", sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .tile { background: linear-gradient(to bottom, var(--tile-top) 50%, var(--tile) 50%); }
  .tile::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    top: 50%;
    height: 1px;
    background: rgb(0 0 0 / 0.5);
  }
  .tile > * { position: relative; z-index: 1; }
  .shipped { color: var(--slop); }
  .shipped svg { width: 46px; height: 46px; }
  .today::before {
    content: "";
    position: absolute;
    inset-inline: 9px;
    bottom: 8px;
    z-index: 1;
    height: 4px;
    border-radius: 9999px;
    background: var(--slop);
  }
  .upcoming { border: 1.5px solid rgb(238 240 232 / 0.15); color: var(--board-muted); }
</style>
</head>
<body>
  <header class="top">
    <div class="brand"><img src="${LOGO}" alt="">slopper</div>
    <span class="url">slopper.day</span>
  </header>
  <h1>Too much slop?<br>Not enough yet!</h1>
  <section class="board">
    <div class="goal">
      <h2>7 slops in 7 days</h2>
      <p>Day 4 of 7 · 3-day streak</p>
    </div>
    <ol class="days">${DAYS.join("")}</ol>
  </section>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  await page.setContent(HTML);
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
  if (overflow) throw new Error("The card's content is wider than the card; shrink the headline.");
  await page.screenshot({ path: OUTPUT, type: "png" });
  console.log(`Wrote ${OUTPUT}`);
} finally {
  await browser.close();
}
