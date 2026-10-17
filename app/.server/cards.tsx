import type { ReactNode } from "react";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori from "satori";
import { fonts as fontData, resvgWasm } from "virtual:og-assets";
import { CARD_SIZE, type ProfileCardData, type SlopCardSlop } from "~/lib/cards";
import { dayLabel, numberLabel } from "~/lib/display";
import type { DayState } from "~/lib/goal";

/**
 * Share cards: the 1200×630 images links to slops and profiles show on X,
 * LinkedIn, Bluesky and chat apps. Satori lays the card out as SVG and resvg
 * draws it as a PNG, both from assets vite.config.ts inlines (`ogAssets`).
 */

const { width: CARD_WIDTH, height: CARD_HEIGHT } = CARD_SIZE;

const C = {
  ground: "#f4f5f0",
  ink: "#161a13",
  muted: "#575d50",
  board: "#161a13",
  boardInk: "#eef0e8",
  boardMuted: "#9aa18f",
  tile: "#262b22",
  slop: "#9be22d",
  slopInk: "#10140b",
  gold: "#ffc21a",
};
const DISPLAY = "Big Shoulders";
const SANS = "Schibsted Grotesk";

let ready: Promise<unknown> | null = null;

function fonts() {
  const decode = (base64: string) => Buffer.from(base64, "base64");
  return [
    { name: DISPLAY, data: decode(fontData.display800), weight: 800 as const, style: "normal" as const },
    { name: DISPLAY, data: decode(fontData.display900), weight: 900 as const, style: "normal" as const },
    { name: SANS, data: decode(fontData.sans400), weight: 400 as const, style: "normal" as const },
    { name: SANS, data: decode(fontData.sans600), weight: 600 as const, style: "normal" as const },
  ];
}
let fontList: ReturnType<typeof fonts> | null = null;

/** Draws a card as a PNG. */
export async function renderCard(card: ReactNode): Promise<Uint8Array<ArrayBuffer>> {
  ready ??= initWasm(Buffer.from(resvgWasm, "base64"));
  await ready;
  fontList ??= fonts();
  const svg = await satori(card, { width: CARD_WIDTH, height: CARD_HEIGHT, fonts: fontList });
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: CARD_WIDTH } }).render().asPng());
}

/**
 * A card as an image response. Card URLs change with what they show
 * (app/lib/cards.ts), so Netlify's CDN keeps each one for a day and serves a
 * stale copy while it redraws, rather than drawing one per crawler.
 */
export function cardResponse(png: Uint8Array<ArrayBuffer>): Response {
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
      "netlify-cdn-cache-control": "public, durable, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

/** A screenshot as a data URL for the card, or null when it can't be fetched in time or isn't PNG or JPEG. */
export async function cardImage(url: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(4_000) });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || (type !== "image/png" && type !== "image/jpeg")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 6 * 1024 * 1024) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (error) {
    console.warn(`Couldn't fetch ${url} for a share card`, error);
    return null;
  }
}

/** The splat mark: lime over a nudged ink copy (public/favicon.svg). */
function Splat({ size }: { size: number }) {
  return (
    <svg width={size} height={(size * 61) / 63} viewBox="2 2 63 61">
      <path
        fill={C.ink}
        d="M51.4 33.4Q51.7 38.2 58.1 43.6Q64.5 49 56.1 49.8Q47.7 50.4 44 51.4Q40.2 52.4 35.2 52.6Q30.1 52.7 25.5 52.3Q20.9 51.8 20.8 48.3Q20.7 44.8 14.3 41.8Q7.9 38.9 8.5 33.1Q9.1 27.4 10.8 19.7Q12.4 11.9 19.9 14.7Q27.4 17.5 31 17.9Q34.6 18.4 39.8 13.9Q44.9 9.4 50 14.8Q55.2 20.2 53.2 24.5Q51.2 28.7 51.4 33.4Z"
      />
      <path
        fill={C.slop}
        d="M47.4 29.4Q47.6 34.1 54 39.5Q60.4 45 52 45.7Q43.6 46.4 39.9 47.3Q36.1 48.4 31.1 48.5Q26.1 48.7 21.4 48.2Q16.9 47.7 16.7 44.2Q16.6 40.8 10.2 37.8Q3.8 34.8 4.4 29.1Q5 23.3 6.7 15.6Q8.4 7.8 15.9 10.6Q23.4 13.4 27 13.9Q30.6 14.4 35.7 9.8Q40.9 5.3 46 10.7Q51.2 16.1 49.2 20.4Q47.1 24.7 47.4 29.4Z"
      />
    </svg>
  );
}

function Check({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={C.slop}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function UpArrow({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={C.slop}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </svg>
  );
}

function Wordmark({ ink }: { ink: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Splat size={48} />
      <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 44, color: ink }}>slopper</div>
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone: "board" | "lime" | "gold" }) {
  const colors = {
    board: { background: C.board, color: C.boardInk },
    lime: { background: C.slop, color: C.slopInk },
    gold: { background: C.gold, color: C.ink },
  }[tone];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 18px",
        borderRadius: 14,
        fontFamily: DISPLAY,
        fontWeight: 800,
        fontSize: 30,
        ...colors,
      }}
    >
      {children}
    </div>
  );
}

/** Text without emoji, which the card's fonts can't draw. */
export function plainText(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Long names shrink so they still fit in two lines. */
function nameSize(name: string): number {
  if (name.length <= 10) return 124;
  if (name.length <= 18) return 100;
  if (name.length <= 30) return 80;
  return 64;
}

export interface SlopCardProps {
  slop: SlopCardSlop;
  username: string;
  /** The cover screenshot as a data URL; null for none, or a slop that's blurred as NSFW. */
  screenshot: string | null;
}

export function SlopCard({ slop, username, screenshot }: SlopCardProps) {
  const name = plainText(slop.name) || "Untitled slop";
  const tagline = plainText(slop.tagline);
  const facts = [`Slop ${numberLabel(slop)}`, slop.launchLabel, dayLabel(slop)].filter((fact) => fact !== null);
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        background: C.ground,
        padding: 56,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: screenshot ? 590 : 580 }}>
        <Wordmark ink={C.ink} />
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", marginBottom: "auto", gap: 18 }}>
          <div
            style={{
              display: "flex",
              fontFamily: DISPLAY,
              fontWeight: 800,
              fontSize: 30,
              color: C.muted,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {facts.join(" · ")}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: DISPLAY,
              fontWeight: 900,
              fontSize: nameSize(name),
              lineHeight: 0.92,
              color: C.ink,
            }}
          >
            {name}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: SANS,
              fontWeight: 400,
              fontSize: 32,
              lineHeight: 1.3,
              color: C.muted,
            }}
          >
            {tagline.length > 110 ? `${tagline.slice(0, 108)}…` : tagline}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{ display: "flex", fontFamily: SANS, fontWeight: 600, fontSize: 30, color: C.ink, marginRight: 6 }}
          >
            @{username}
          </div>
          <Chip tone="board">
            <UpArrow size={26} />
            {String(slop.upvotes)}
          </Chip>
          {slop.slopcessfulAt ? (
            <Chip tone="gold">Slopcessful</Chip>
          ) : slop.slopOfTheDay ? (
            <Chip tone="gold">Slop of the day</Chip>
          ) : null}
        </div>
      </div>
      {/* Slapped on the wall: a dark frame, slightly askew, running off the edge so a wide screenshot keeps its top-left. */}
      {screenshot ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 690,
            top: 74,
            width: 660,
            height: 482,
            padding: 12,
            borderRadius: 32,
            background: C.board,
            transform: "rotate(2deg)",
          }}
        >
          <img
            src={screenshot}
            width={636}
            height={458}
            style={{ borderRadius: 21, objectFit: "cover", objectPosition: "top left" }}
          />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 684,
            top: 56,
            width: 460,
            height: 518,
            borderRadius: 32,
            background: C.board,
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(2deg)",
          }}
        >
          <Splat size={260} />
        </div>
      )}
    </div>
  );
}

/** The goal grid's days in one row, styled like GoalGrid: a check, a dot, today's lime bar, or the day's number. */
function GoalTiles({ days }: { days: DayState[] }) {
  const height = days.length <= 7 ? 128 : days.length <= 14 ? 92 : 52;
  const gap = days.length <= 14 ? 14 : 5;
  const radius = days.length <= 14 ? 16 : 7;
  return (
    <div style={{ display: "flex", gap }}>
      {days.map((state, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            flex: 1,
            height,
            borderRadius: radius,
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            background:
              state === "shipped" || state === "today"
                ? C.tile
                : state === "missed"
                  ? "rgba(38,43,34,0.5)"
                  : "transparent",
            border:
              state === "upcoming"
                ? "2px solid rgba(238,240,232,0.15)"
                : state === "today"
                  ? `2px solid ${C.slop}`
                  : "none",
            fontFamily: DISPLAY,
            fontWeight: 800,
            fontSize: height * 0.42,
            color: C.boardMuted,
          }}
        >
          {state === "shipped" ? (
            <Check size={Math.min(height * 0.5, 64)} />
          ) : state === "missed" ? (
            <div style={{ display: "flex", width: 10, height: 10, borderRadius: 5, background: C.boardMuted }} />
          ) : days.length <= 14 ? (
            String(index + 1)
          ) : null}
          {state === "today" ? (
            <div
              style={{
                display: "flex",
                position: "absolute",
                left: 10,
                right: 10,
                bottom: 8,
                height: 5,
                borderRadius: 3,
                background: C.slop,
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ProfileCard(profile: ProfileCardData) {
  const displayName = plainText(profile.displayName) || `@${profile.username}`;
  const stats = [
    `${profile.slops} ${profile.slops === 1 ? "slop" : "slops"}`,
    `${profile.streak}-day streak`,
    profile.daysWon > 0 ? `${profile.daysWon} ${profile.daysWon === 1 ? "day" : "days"} won` : null,
  ].filter((stat) => stat !== null);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        background: C.board,
        padding: 56,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark ink={C.boardInk} />
        <div style={{ display: "flex", fontFamily: SANS, fontWeight: 600, fontSize: 28, color: C.boardMuted }}>
          slopper.day/@{profile.username}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", gap: 10 }}>
        <div
          style={{
            display: "flex",
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: displayName.length > 18 ? 80 : 104,
            lineHeight: 0.92,
            color: C.boardInk,
          }}
        >
          {displayName}
        </div>
        <div style={{ display: "flex", fontFamily: SANS, fontWeight: 400, fontSize: 30, color: C.boardMuted }}>
          {stats.join(" · ")}
        </div>
      </div>
      {profile.goal ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 40 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: DISPLAY,
                  fontWeight: 800,
                  fontSize: 52,
                  lineHeight: 1,
                  color: C.boardInk,
                }}
              >
                {plainText(profile.goal.title)}
              </div>
              <div style={{ display: "flex", fontFamily: SANS, fontWeight: 400, fontSize: 26, color: C.boardMuted }}>
                Day {profile.goal.currentDay} of {profile.goal.days.length}
              </div>
            </div>
            <div
              style={{ display: "flex", alignItems: "baseline", fontFamily: DISPLAY, fontWeight: 900, lineHeight: 1 }}
            >
              <div style={{ display: "flex", fontSize: 84, color: C.slop }}>{String(profile.goal.shipped)}</div>
              <div style={{ display: "flex", fontSize: 44, color: C.boardMuted }}>/{profile.goal.target} slopped</div>
            </div>
          </div>
          <GoalTiles days={profile.goal.days} />
        </div>
      ) : (
        <div
          style={{ display: "flex", marginTop: 36, fontFamily: DISPLAY, fontWeight: 800, fontSize: 52, color: C.slop }}
        >
          Too much slop? Not enough yet!
        </div>
      )}
    </div>
  );
}
