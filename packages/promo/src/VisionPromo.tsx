import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, Check, DISPLAY, EndCard, FlapText, MONO, Splat, Tile, useLayout } from "./brand";

/**
 * Concept 4, "The vision": what Slopper is for, not how to set it up. Cut to
 * "Keeping Fit" by Ahjay Stelino (Mixkit Stock Music Free License). Scenes
 * start on bar lines and the big moments sit on accents, from
 * `node scripts/beats.ts public/music-keeping-fit.mp3` (129.75 bpm, 13.87
 * frames a beat). It ends on the track's break at about 24 s.
 */
const BEAT = 13.87;
/** Bar lines. Bar 0 is the first hit after the riser; bar 8 brings a new melody; bar 12 is the break. */
const BARS = [54, 110, 165, 221, 276, 332, 387, 443, 498, 554, 609, 665, 720];
const bar = (index: number) => BARS[index];
const beat = (barIndex: number, beats: number) => Math.round(BARS[barIndex] + beats * BEAT);
export const VISION_FRAMES = bar(12);

function visible(frame: number, from: number, to: number): number {
  return frame >= from && frame < to ? 1 : 0;
}

function pulse(frame: number, at: number, by = 0.04): number {
  return 1 + by * Math.max(0, 1 - Math.abs(frame - at) / 7);
}

/** A headline that types itself out from `at`, a few characters a frame, with a block caret. */
function Typed({
  text,
  at,
  size,
  color = C.boardInk,
  speed = 2,
}: {
  text: string;
  at: number;
  size: number;
  color?: string;
  speed?: number;
}) {
  const frame = useCurrentFrame();
  const shown = Math.max(0, Math.min(text.length, Math.floor((frame - at) * speed)));
  const done = shown === text.length;
  const caret = !done || Math.floor(frame / 8) % 2 === 0;
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1,
        color,
        textAlign: "center",
        opacity: frame >= at ? 1 : 0,
        maxWidth: "90vw",
        margin: "0 auto",
      }}
    >
      {text.slice(0, shown)}
      <span
        style={{
          display: "inline-block",
          width: size * 0.38,
          height: size * 0.82,
          marginLeft: size * 0.08,
          verticalAlign: "-0.08em",
          background: C.slop,
          opacity: caret ? 1 : 0,
        }}
      />
    </div>
  );
}

function Hook() {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const size = (portrait ? 104 : 130) * u;
  // Rattle through the riser so the first row lands on the hit.
  const first = bar(0) - 13 * 2 - 6;
  return (
    <AbsoluteFill
      style={{
        opacity: visible(frame, 0, bar(2)),
        alignItems: "center",
        justifyContent: "center",
        background: C.board,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: size * 0.3,
          alignItems: "center",
          transform: `scale(${pulse(frame, bar(0)) * pulse(frame, bar(1))})`,
        }}
      >
        {portrait ? (
          <>
            <FlapText text="TOO MUCH" start={first} size={size} stagger={2} cycles={8} sound={0.18} />
            <FlapText text="SLOP?" start={first + 6} size={size} stagger={2} cycles={8} sound={0.18} />
            <FlapText
              text="NOT ENOUGH"
              start={bar(1) - 28}
              size={size}
              tone="lime"
              stagger={2}
              cycles={5}
              sound={0.18}
            />
            <FlapText text="YET!" start={bar(1) - 12} size={size} tone="lime" stagger={2} cycles={2} sound={0.18} />
          </>
        ) : (
          <>
            <FlapText text="TOO MUCH SLOP?" start={first} size={size} stagger={2} cycles={3} sound={0.18} />
            <FlapText
              text="NOT ENOUGH YET!"
              start={bar(1) - 34}
              size={size}
              tone="lime"
              stagger={2}
              cycles={2}
              sound={0.18}
            />
          </>
        )}
      </div>
    </AbsoluteFill>
  );
}

/** "Set a goal.": the 7-day board ticks a lime check on every beat. */
function GoalScene({ from, to }: { from: number; to: number }) {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const size = (portrait ? 150 : 172) * u;
  const ticks = Array.from({ length: 7 }, (_, index) => Math.round(from + BEAT * (index + 1)));
  const shipped = ticks.filter((at) => frame >= at).length;
  return (
    <AbsoluteFill
      style={{
        opacity: visible(frame, from, to),
        alignItems: "center",
        justifyContent: "center",
        background: C.board,
        gap: 60 * u,
        flexDirection: "column",
      }}
    >
      <Typed text="Set a goal." at={from} size={(portrait ? 120 : 140) * u} />
      {/* Wraps four to a row in portrait, the second row centred under the first. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 18 * u,
          maxWidth: portrait ? 4 * size * 0.78 + 3 * 18 * u + 1 : undefined,
        }}
      >
        {ticks.map((at, index) =>
          index < shipped ? (
            <Tile key={index} size={size}>
              <div
                style={{
                  transform: `scale(${interpolate(frame - at, [0, 4], [0.5, 1], { extrapolateRight: "clamp" })})`,
                }}
              >
                <Check size={size * 0.62} />
              </div>
            </Tile>
          ) : (
            <div
              key={index}
              style={{
                width: size * 0.78,
                height: size * 1.18,
                borderRadius: size * 0.14,
                border: `${2 * u}px solid rgba(238,240,232,0.16)`,
                display: "grid",
                placeItems: "center",
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: size * 0.5,
                color: C.boardMuted,
              }}
            >
              {index + 1}
            </div>
          ),
        )}
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 64 * u, color: C.boardMuted }}>
        {shipped}/7 slopped
      </div>
    </AbsoluteFill>
  );
}

const THROWS = [
  { label: "a game", x: 0.24, y: 0.6 },
  { label: "a site", x: 0.74, y: 0.52 },
  { label: "an app", x: 0.4, y: 0.78 },
  { label: "a bot", x: 0.66, y: 0.8 },
];

/** "Ship something every day.": ideas splat onto the wall, two beats apart. */
function ShipScene({ from, to }: { from: number; to: number }) {
  const frame = useCurrentFrame();
  const { u, portrait, width, height } = useLayout();
  const size = (portrait ? 330 : 300) * u;
  return (
    <AbsoluteFill style={{ opacity: visible(frame, from, to), background: C.ground }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: (portrait ? 300 : 120) * u }}>
        <Typed text="Ship something every day." at={from} size={(portrait ? 128 : 120) * u} color={C.ink} speed={2.6} />
      </div>
      {THROWS.map((spec, index) => {
        const hit = Math.round(from + BEAT * (1 + index * 2));
        const flight = interpolate(frame, [hit - 8, hit], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        if (frame < hit - 8) return null;
        const x = interpolate(flight, [0, 1], [index % 2 ? width + size : -size, spec.x * width]);
        const y =
          interpolate(flight, [0, 1], [height * 1.05, spec.y * height]) - Math.sin(flight * Math.PI) * height * 0.2;
        const squash =
          frame < hit ? 1 : interpolate(frame - hit, [0, 3, 8], [1.3, 0.92, 1], { extrapolateRight: "clamp" });
        return (
          <div
            key={spec.label}
            style={{
              position: "absolute",
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              transform: `rotate(${frame < hit ? flight * 400 : 0}deg) scale(${squash}, ${2 - squash})`,
            }}
          >
            <Splat size={size} />
            {frame >= hit && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: DISPLAY,
                  fontWeight: 900,
                  fontSize: 64 * u,
                  color: C.slopInk,
                  transform: "translate(-6%, -4%)",
                }}
              >
                {spec.label}
              </div>
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

const RIVALS = [
  { name: "Slopper", end: 31 },
  { name: "TiltMaze", end: 24 },
  { name: "Kites", end: 17 },
];

/** "Win the day.": Slopper climbs today's race, then the day's winner lands in gold on the accent. */
function WinScene({ from, crown, to }: { from: number; crown: number; to: number }) {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const progress = interpolate(frame, [from + 6, crown - 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const votes = RIVALS.map((rival, index) =>
    Math.round(rival.end * (index === 0 ? progress ** 1.8 : Math.min(1, progress * 1.3))),
  );
  const order = votes.map((vote, index) => ({ vote, index })).sort((a, b) => b.vote - a.vote || a.index - b.index);
  const rowHeight = (portrait ? 170 : 150) * u;
  const won = frame >= crown;
  return (
    <AbsoluteFill
      style={{
        opacity: visible(frame, from, to),
        alignItems: "center",
        justifyContent: "center",
        background: C.board,
        gap: 50 * u,
        flexDirection: "column",
      }}
    >
      <Typed text="Win the day." at={from} size={(portrait ? 120 : 140) * u} />
      {!won ? (
        <div style={{ position: "relative", width: (portrait ? 940 : 1300) * u, height: rowHeight * 3 }}>
          {RIVALS.map((rival, index) => {
            const rank = order.findIndex((entry) => entry.index === index);
            return (
              <div
                key={rival.name}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: rank * rowHeight,
                  height: rowHeight - 16 * u,
                  display: "flex",
                  alignItems: "center",
                  gap: 28 * u,
                  padding: `0 ${34 * u}px`,
                  borderRadius: 26 * u,
                  background: index === 0 ? "rgba(155,226,45,0.16)" : "rgba(238,240,232,0.06)",
                }}
              >
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 900,
                    fontSize: 80 * u,
                    color: index === 0 ? C.slop : C.boardMuted,
                    width: 70 * u,
                  }}
                >
                  {rank + 1}
                </div>
                <div style={{ flex: 1, fontFamily: DISPLAY, fontWeight: 800, fontSize: 76 * u, color: C.boardInk }}>
                  {rival.name}
                </div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 86 * u, color: C.boardInk }}>
                  ↑ {votes[index]}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20 * u,
            transform: `scale(${pulse(frame, crown, 0.08)})`,
          }}
        >
          {portrait ? (
            <>
              <FlapText text="SLOP" start={crown - 10} size={140 * u} tone="gold" stagger={1} cycles={2} sound={0} />
              <FlapText text="CESSFUL" start={crown - 6} size={140 * u} tone="gold" stagger={1} cycles={1} sound={0} />
            </>
          ) : (
            <FlapText
              text="SLOPCESSFUL"
              start={crown - 12}
              size={150 * u}
              tone="gold"
              stagger={1}
              cycles={1}
              sound={0}
            />
          )}
        </div>
      )}
    </AbsoluteFill>
  );
}

/** "Or let your agent ship it.": one command, one green ok. */
function AgentScene({ from, ok, to }: { from: number; ok: number; to: number }) {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const command = "slopper launch --name Slopper";
  const typedAt = from + 8;
  const typed = Math.max(0, Math.min(command.length, Math.floor((frame - typedAt) * 1.6)));
  return (
    <AbsoluteFill
      style={{
        opacity: visible(frame, from, to),
        alignItems: "center",
        justifyContent: "center",
        background: C.ground,
        gap: 60 * u,
        flexDirection: "column",
      }}
    >
      <Typed text="Or let your agent ship it." at={from} size={(portrait ? 124 : 120) * u} color={C.ink} speed={2.6} />
      <div
        style={{
          width: (portrait ? 980 : 1500) * u,
          borderRadius: 30 * u,
          background: "#0e110c",
          padding: `${44 * u}px ${48 * u}px`,
          fontFamily: MONO,
          fontSize: (portrait ? 46 : 56) * u,
          lineHeight: 1.5,
          color: C.boardInk,
          transform: `scale(${pulse(frame, ok, 0.04)})`,
        }}
      >
        <div>
          <span style={{ color: C.slop }}>$ </span>
          {command.slice(0, typed)}
          {frame < ok && Math.floor(frame / 8) % 2 === 0 && (
            <span style={{ background: C.boardInk, color: "transparent" }}>_</span>
          )}
        </div>
        {frame >= ok && <div style={{ color: C.slop }}>✓ Slopper is on the wall. Day 1 of 7.</div>}
      </div>
    </AbsoluteFill>
  );
}

function ChallengeScene({ from, second, to }: { from: number; second: number; to: number }) {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  return (
    <AbsoluteFill
      style={{
        opacity: visible(frame, from, to),
        alignItems: "center",
        justifyContent: "center",
        background: C.board,
        gap: 30 * u,
        flexDirection: "column",
      }}
    >
      <div style={{ transform: `scale(${pulse(frame, from, 0.06)})` }}>
        <Typed text="7 apps in 7 days." at={from} size={(portrait ? 136 : 170) * u} color={C.slop} speed={3} />
      </div>
      <div style={{ opacity: frame >= second ? 1 : 0, transform: `scale(${pulse(frame, second, 0.06)})` }}>
        <Typed text="Day 1: this." at={second} size={(portrait ? 100 : 120) * u} speed={3} />
      </div>
    </AbsoluteFill>
  );
}

export function VisionPromo() {
  const frame = useCurrentFrame();
  // The track is mastered hot; this leaves headroom, and it fades into the break.
  const volume = (frame: number) =>
    interpolate(frame, [VISION_FRAMES - 14, VISION_FRAMES], [0.72, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return (
    <AbsoluteFill style={{ background: C.board }}>
      <Audio src={staticFile("music-keeping-fit.mp3")} volume={volume} />
      <Hook />
      <GoalScene from={bar(2)} to={bar(4)} />
      <ShipScene from={bar(4)} to={bar(6)} />
      <WinScene from={bar(6)} crown={beat(7, 1.4)} to={bar(8)} />
      <AgentScene from={bar(8)} ok={bar(9)} to={bar(10)} />
      <ChallengeScene from={bar(10)} second={beat(10, 2)} to={bar(11)} />
      <AbsoluteFill style={{ opacity: visible(frame, bar(11), VISION_FRAMES) }}>
        <EndCard start={bar(11)} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
