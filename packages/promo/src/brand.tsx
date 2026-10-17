import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/** Slopper's tokens (DESIGN.md). Lime is spent on shipping; gold on winning. */
export const C = {
  ground: "#f4f5f0",
  sunk: "#e9ebe3",
  ink: "#161a13",
  muted: "#575d50",
  board: "#161a13",
  boardInk: "#eef0e8",
  boardMuted: "#9aa18f",
  tile: "#262b22",
  tileTop: "#2e3429",
  slop: "#9be22d",
  slopInk: "#10140b",
  gold: "#ffc21a",
  hot: "#c4371b",
};

export const DISPLAY = '"Big Shoulders", "Arial Narrow", sans-serif';
export const SANS = '"Schibsted Grotesk", system-ui, sans-serif';
export const MONO = '"Atkinson Mono", ui-monospace, monospace';

const fontsReady = delayRender("Loading Slopper's fonts");
Promise.all([
  new FontFace("Big Shoulders", `url(${staticFile("big-shoulders.woff2")})`, { weight: "100 900" }).load(),
  new FontFace("Schibsted Grotesk", `url(${staticFile("schibsted.woff2")})`, { weight: "400 900" }).load(),
  new FontFace("Atkinson Mono", `url(${staticFile("mono.woff2")})`, { weight: "200 800" }).load(),
])
  .then((faces) => {
    // Chrome has FontFaceSet.add; TypeScript's DOM types leave it out.
    const fonts = document.fonts as FontFaceSet & { add(face: FontFace): void };
    for (const face of faces) fonts.add(face);
    continueRender(fontsReady);
  })
  .catch((error: unknown) => cancelRender(error instanceof Error ? error : new Error(String(error))));

/** Sizes scale with the short side, so one layout reads the same in portrait and landscape. */
export function useLayout() {
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const portrait = height > width;
  return { width, height, fps, durationInFrames, portrait, u: Math.min(width, height) / 1080 };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SEPARATORS = new Set([" ", ":", ".", "/", ",", "·"]);

function scramble(index: number, step: number): string {
  const n = Math.abs(Math.sin(index * 12.9898 + step * 78.233) * 43_758.5453);
  return ALPHABET[Math.floor((n - Math.floor(n)) * ALPHABET.length)];
}

export type TileTone = "board" | "lime" | "gold";

const TONES: Record<TileTone, { top: string; bottom: string; ink: string }> = {
  board: { top: C.tileTop, bottom: C.tile, ink: C.boardInk },
  lime: { top: "#a8e84a", bottom: C.slop, ink: C.slopInk },
  gold: { top: "#ffcb3d", bottom: C.gold, ink: C.ink },
};

/** One split-flap tile: two halves and a hairline split, the glyph across it. */
export function Tile({
  size,
  tone = "board",
  children,
  style,
}: {
  size: number;
  tone?: TileTone;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const colors = TONES[tone];
  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        width: size * 0.78,
        height: size * 1.18,
        borderRadius: size * 0.14,
        background: `linear-gradient(to bottom, ${colors.top} 50%, ${colors.bottom} 50%)`,
        color: colors.ink,
        fontFamily: DISPLAY,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: Math.max(1, size * 0.012),
          background: "rgba(0,0,0,0.45)",
        }}
      />
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

export function Check({ size, color = C.slop }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The characters of a flap word as people see them, one per tile. */
function glyphs(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), ({ segment }) => segment);
}

/** When each tile of a flap word lands, relative to its start. */
export function settleFrames(text: string, stagger: number, cycles: number): number[] {
  return glyphs(text).map((_, index) => index * stagger + cycles * 2);
}

/**
 * Text on split-flap tiles: each tile rattles through letters from `start`
 * and lands left to right, with a clack as it lands.
 */
export function FlapText({
  text,
  start,
  size,
  tone = "board",
  stagger = 2,
  cycles = 5,
  gap = 0.1,
  sound = 0.32,
}: {
  text: string;
  start: number;
  size: number;
  tone?: TileTone;
  stagger?: number;
  cycles?: number;
  gap?: number;
  sound?: number;
}) {
  const frame = useCurrentFrame();
  const chars = glyphs(text);
  const settles = settleFrames(text, stagger, cycles);
  return (
    <div style={{ display: "flex", gap: size * gap, alignItems: "center" }}>
      {chars.map((char, index) => {
        if (SEPARATORS.has(char)) {
          return (
            <div
              key={index}
              style={{
                width: char === " " ? size * 0.32 : size * 0.3,
                textAlign: "center",
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: size,
                color: tone === "board" ? C.boardInk : C.ink,
                opacity: frame >= start + settles[index] ? 0.75 : 0,
              }}
            >
              {char === " " ? "" : char}
            </div>
          );
        }
        const local = frame - start;
        const settled = local >= settles[index];
        const step = Math.floor(local / 2);
        const shown = local < 0 ? "" : settled ? char : scramble(index, step);
        // The glyph drops in like a falling flap on every change.
        const phase = settled ? Math.min(1, (local - settles[index]) / 3) : (local % 2) / 2;
        const squash = local < 0 ? 1 : interpolate(phase, [0, 1], [0.55, 1]);
        return (
          <Tile key={index} size={size} tone={settled ? tone : "board"}>
            <span style={{ display: "inline-block", transform: `scaleY(${squash})` }}>{shown}</span>
          </Tile>
        );
      })}
      {sound > 0 &&
        settles.map((at, index) =>
          SEPARATORS.has(chars[index]) ? null : (
            <Sequence key={`clack-${index}`} from={start + at} durationInFrames={6} layout="none">
              <Audio src={staticFile("flap.wav")} volume={sound} />
            </Sequence>
          ),
        )}
    </div>
  );
}

/** Slopper's splat mark. */
export function Splat({ size, style }: { size: number; style?: CSSProperties }) {
  return <Img src={staticFile("splat.svg")} style={{ width: size, height: size * (61 / 63), ...style }} />;
}

/** A spring that starts at `at`, for entrances. */
export function useEnter(at: number, damping = 14) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping, mass: 0.6 } });
}

/** The closing card every cut ends on: the splat, the address, the promise. */
export function EndCard({ start, tagline = "Too much slop? Not enough yet!" }: { start: number; tagline?: string }) {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const pop = useEnter(start, 9);
  const line = useEnter(start + 8);
  const sub = useEnter(start + 14);
  const local = frame - start;
  return (
    <AbsoluteFill
      style={{ background: C.ground, alignItems: "center", justifyContent: "center", opacity: local < 0 ? 0 : 1 }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 * u }}>
        <Splat size={(portrait ? 320 : 280) * u} style={{ transform: `scale(${pop}) rotate(${(1 - pop) * -20}deg)` }} />
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: (portrait ? 190 : 230) * u,
            lineHeight: 0.9,
            color: C.ink,
            transform: `translateY(${(1 - line) * 40 * u}px)`,
            opacity: line,
          }}
        >
          slopper.day
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: 52 * u,
            color: C.muted,
            opacity: sub,
            transform: `translateY(${(1 - sub) * 20 * u}px)`,
            textAlign: "center",
            maxWidth: 900 * u,
          }}
        >
          {tagline}
        </div>
      </div>
    </AbsoluteFill>
  );
}
