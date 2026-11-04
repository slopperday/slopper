import type { ReactNode } from "react";
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, Check, DISPLAY, EndCard, FlapText, MONO, SANS, useEnter, useLayout } from "./brand";

/**
 * The studio demo on the "Slopper Studio" slop: set it up, write one post for
 * every network, promote your slops, run all your social posting, and what
 * it costs. Everything on screen is a mock of the real pages. Cut to "Keeping
 * Fit" by Ahjay Stelino (Mixkit Stock Music Free License); scenes start on
 * the bar lines `node scripts/beats.ts public/music-keeping-fit.mp3` found
 * (129.75 bpm, 13.87 frames a beat), and it ends where the track drops back
 * at about 41 s.
 */
const BEAT = 13.87;
const DOWN = [
  54, 110, 165, 221, 276, 332, 387, 443, 498, 554, 609, 665, 720, 776, 831, 887, 942, 998, 1053, 1108, 1164, 1219,
];
const bar = (index: number) => DOWN[index];
const beat = (barIndex: number, beats: number) => Math.round(DOWN[barIndex] + beats * BEAT);
export const STUDIO_FRAMES = 1240;

const NETWORKS = [
  { name: "X", color: "#000000", glyph: "𝕏" },
  { name: "LinkedIn", color: "#0a66c2", glyph: "in" },
  { name: "Bluesky", color: "#1185fe", glyph: "🦋" },
  { name: "Threads", color: "#101010", glyph: "@" },
  { name: "Facebook", color: "#1877f2", glyph: "f" },
  { name: "Instagram", color: "#d62976", glyph: "◎" },
  { name: "TikTok", color: "#111111", glyph: "♪" },
  { name: "YouTube", color: "#ff0000", glyph: "▶" },
  { name: "Mastodon", color: "#6364ff", glyph: "M" },
  { name: "Discord", color: "#5865f2", glyph: "D" },
  { name: "Telegram", color: "#229ed9", glyph: "✈" },
  { name: "Reddit", color: "#ff4500", glyph: "r/" },
] as const;
type Network = (typeof NETWORKS)[number];
const net = (name: string) => NETWORKS.find((item) => item.name === name)!;

function Scene({ from, to, children, light }: { from: number; to: number; children: ReactNode; light?: boolean }) {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  return (
    <AbsoluteFill style={{ background: light ? C.ground : C.board, alignItems: "center", justifyContent: "center" }}>
      {children}
    </AbsoluteFill>
  );
}

function Badge({ network, size }: { network: Network; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: network.color,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontFamily: SANS,
        fontWeight: 800,
        fontSize: size * 0.46,
        flexShrink: 0,
        boxShadow: `0 ${size * 0.06}px 0 rgba(0,0,0,0.25)`,
      }}
    >
      {network.glyph}
    </div>
  );
}

/** The step label in the corner of each scene: "1 · Set it up". */
function Step({ at, n, title, light }: { at: number; n: string; title: string; light?: boolean }) {
  const { u, portrait } = useLayout();
  const enter = useEnter(at, 12);
  return (
    <div
      style={{
        position: "absolute",
        top: (portrait ? 150 : 70) * u,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 22 * u,
        opacity: enter,
        transform: `translateY(${(1 - enter) * -30 * u}px)`,
      }}
    >
      <div
        style={{
          width: 86 * u,
          height: 86 * u,
          borderRadius: 999,
          background: C.slop,
          color: C.slopInk,
          display: "grid",
          placeItems: "center",
          fontFamily: DISPLAY,
          fontWeight: 900,
          fontSize: 62 * u,
        }}
      >
        {n}
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 84 * u, color: light ? C.ink : C.boardInk }}>
        {title}
      </div>
    </div>
  );
}

function Caption({ at, children, light }: { at: number; children: ReactNode; light?: boolean }) {
  const { u, portrait } = useLayout();
  const enter = useEnter(at, 14);
  return (
    <div
      style={{
        position: "absolute",
        bottom: (portrait ? 190 : 70) * u,
        left: 60 * u,
        right: 60 * u,
        textAlign: "center",
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: 44 * u,
        color: light ? C.muted : C.boardMuted,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 24 * u}px)`,
      }}
    >
      {children}
    </div>
  );
}

/** A white card like the site's panels. */
function Panel({ children, width, style }: { children: ReactNode; width: number; style?: React.CSSProperties }) {
  const { u } = useLayout();
  return (
    <div
      style={{
        width,
        background: "#fff",
        borderRadius: 28 * u,
        border: `${3 * u}px solid ${C.ink}`,
        boxShadow: `0 ${10 * u}px 0 ${C.ink}`,
        padding: 30 * u,
        fontFamily: SANS,
        color: C.ink,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Hook() {
  const { u, portrait } = useLayout();
  const size = (portrait ? 120 : 150) * u;
  return (
    <Scene from={0} to={bar(2)}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30 * u }}>
        <FlapText text="ONE POST" start={bar(0) - 22} size={size} tone="lime" />
        <FlapText text={portrait ? "EVERY" : "EVERY NETWORK"} start={bar(1) - 22} size={size} />
        {portrait && <FlapText text="NETWORK" start={bar(1) - 10} size={size} />}
      </div>
    </Scene>
  );
}

function Networks() {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const columns = portrait ? 3 : 6;
  const size = (portrait ? 200 : 190) * u;
  return (
    <Scene from={bar(2)} to={bar(4)}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, ${size}px)`,
          gap: 44 * u,
          justifyContent: "center",
        }}
      >
        {NETWORKS.map((network, index) => {
          const at = bar(2) + Math.round(index * (BEAT / 2));
          const pop = frame >= at ? Math.min(1, (frame - at) / 5) : 0;
          return (
            <div
              key={network.name}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * u }}
            >
              <div style={{ transform: `scale(${interpolate(pop, [0, 0.7, 1], [0, 1.15, 1])})` }}>
                <Badge network={network} size={size * 0.72} />
              </div>
              <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 30 * u, color: C.boardInk, opacity: pop }}>
                {network.name}
              </div>
            </div>
          );
        })}
      </div>
      <Caption at={beat(3, 0)}>12 networks. Every account and brand you run.</Caption>
    </Scene>
  );
}

function Setup() {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const from = bar(4);
  const shown = ["X", "LinkedIn", "Bluesky", "Instagram", "TikTok", "YouTube", "Reddit"].map(net);
  const width = (portrait ? 920 : 860) * u;
  const guide = useEnter(beat(6, 0), 13);
  return (
    <Scene from={from} to={bar(7)} light>
      <Step at={from} n="1" title="Set it up" light />
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", gap: 40 * u, alignItems: "center" }}>
        <Panel width={width}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 56 * u }}>Settings → Accounts</div>
          <div style={{ display: "grid", gap: 14 * u, marginTop: 20 * u }}>
            {shown.map((network, index) => {
              const at = from + 10 + Math.round(index * BEAT * 0.75);
              const on = frame >= at;
              return (
                <div key={network.name} style={{ display: "flex", alignItems: "center", gap: 18 * u }}>
                  <Badge network={network} size={56 * u} />
                  <div style={{ flex: 1, fontWeight: 700, fontSize: 32 * u }}>{network.name}</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10 * u,
                      padding: `${8 * u}px ${18 * u}px`,
                      borderRadius: 999,
                      fontWeight: 800,
                      fontSize: 26 * u,
                      background: on ? C.slop : C.ink,
                      color: on ? C.slopInk : "#fff",
                    }}
                  >
                    {on ? (
                      <>
                        <Check size={26 * u} color={C.slopInk} /> Connected
                      </>
                    ) : (
                      "Connect"
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel
          width={(portrait ? 920 : 640) * u}
          style={{ opacity: guide, transform: `translateY(${(1 - guide) * 60 * u}px)`, background: C.sunk }}
        >
          <div style={{ fontWeight: 800, fontSize: 34 * u }}>How to set up Reddit</div>
          <ol style={{ margin: `${14 * u}px 0 0`, paddingLeft: 40 * u, fontSize: 26 * u, lineHeight: 1.45 }}>
            <li>Create a web app at reddit.com/prefs/apps</li>
            <li>Paste its redirect address</li>
            <li>Connect Reddit, add your subreddits</li>
          </ol>
          <div style={{ marginTop: 14 * u, fontFamily: MONO, fontSize: 22 * u, color: C.muted }}>
            A guide for every network
          </div>
        </Panel>
      </div>
      <Caption at={beat(5, 2)} light>
        Connect once. Slopper tells you when a connection needs renewing.
      </Caption>
    </Scene>
  );
}

const POST =
  "Tiltmaze 2.0 is out: 40 new levels, a level editor and daily challenges. Tilt your phone to roll the ball home.";

function Compose() {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const from = bar(7);
  const typed = POST.slice(0, Math.max(0, Math.floor((frame - from - 8) * 2.6)));
  const tapped = frame >= beat(8, 2);
  const picture = frame >= beat(9, 1);
  const accounts = ["X", "LinkedIn", "Bluesky", "Threads", "Instagram", "TikTok", "Reddit"].map(net);
  const width = (portrait ? 960 : 1500) * u;
  return (
    <Scene from={from} to={bar(10)} light>
      <Step at={from} n="2" title="Write once" light />
      <Panel width={width} style={{ marginTop: (portrait ? 60 : 90) * u }}>
        <div style={{ display: "flex", gap: 30 * u, flexDirection: portrait ? "column" : "row" }}>
          <div style={{ flex: 1.2 }}>
            <div style={{ display: "flex", gap: 12 * u, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 26 * u, color: C.muted }}>One tap:</span>
              {["Last used", "Post as Tiltmaze"].map((label) => {
                const active = label === "Post as Tiltmaze" && tapped;
                return (
                  <span
                    key={label}
                    style={{
                      padding: `${8 * u}px ${18 * u}px`,
                      borderRadius: 999,
                      border: `${3 * u}px solid ${C.ink}`,
                      fontWeight: 800,
                      fontSize: 26 * u,
                      background: active ? C.slop : "#fff",
                      transform: active
                        ? `scale(${interpolate(frame - beat(8, 2), [0, 4, 8], [0.9, 1.08, 1], { extrapolateRight: "clamp" })})`
                        : undefined,
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10 * u, marginTop: 18 * u, flexWrap: "wrap" }}>
              {accounts.map((network, index) => (
                <div
                  key={network.name}
                  style={{ opacity: tapped && frame >= beat(8, 2) + index ? 1 : 0.25, transition: "none" }}
                >
                  <Badge network={network} size={58 * u} />
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 20 * u,
                minHeight: 170 * u,
                border: `${3 * u}px solid ${C.ink}`,
                borderRadius: 18 * u,
                padding: 18 * u,
                fontSize: 30 * u,
                lineHeight: 1.35,
              }}
            >
              {typed}
              <span style={{ background: C.slop, opacity: Math.floor(frame / 8) % 2 ? 1 : 0 }}>&nbsp;</span>
            </div>
            <div style={{ display: "flex", gap: 14 * u, marginTop: 16 * u, alignItems: "center" }}>
              <div
                style={{
                  width: 130 * u,
                  height: 98 * u,
                  borderRadius: 14 * u,
                  background: picture
                    ? "linear-gradient(135deg,#7c3aed,#ec4899 55%,#f59e0b)"
                    : `repeating-linear-gradient(45deg, ${C.sunk}, ${C.sunk} ${8 * u}px, #fff ${8 * u}px, #fff ${16 * u}px)`,
                  border: `${3 * u}px solid ${C.ink}`,
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: DISPLAY,
                  fontWeight: 900,
                  fontSize: 30 * u,
                }}
              >
                {picture ? "2.0" : "+"}
              </div>
              <div style={{ fontWeight: 700, fontSize: 26 * u, color: C.muted }}>
                {picture ? "tiltmaze.png" : "Add a picture or video"}
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 32 * u, marginBottom: 12 * u }}>Checklist</div>
            {accounts.map((network) => {
              const needsPicture = network.name === "Instagram" || network.name === "TikTok";
              const ok = tapped && (!needsPicture || picture);
              const text = !tapped
                ? "Not picked"
                : ok
                  ? network.name === "X"
                    ? "Ready · about $0.015 to X"
                    : "Ready"
                  : network.name === "TikTok"
                    ? "Needs a video"
                    : "Needs a picture";
              return (
                <div
                  key={network.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12 * u,
                    fontSize: 26 * u,
                    padding: `${5 * u}px 0`,
                  }}
                >
                  <Badge network={network} size={36 * u} />
                  <span style={{ fontWeight: 700, color: ok ? "#3c7a0d" : tapped ? C.hot : C.muted }}>{text}</span>
                  {tapped && !ok && (
                    <span style={{ fontWeight: 800, textDecoration: "underline", fontSize: 22 * u }}>Fix</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
      <Caption at={beat(9, 2)} light>
        Each network gets a copy that fits it, with its own words, link and time if you like.
      </Caption>
    </Scene>
  );
}

function Send() {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const from = bar(10);
  const press = beat(10, 1);
  const cards = ["X", "LinkedIn", "Bluesky", "Threads", "Instagram", "Reddit"].map(net);
  const pressed = frame >= press && frame < press + 6;
  return (
    <Scene from={from} to={bar(12)}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 50 * u }}>
        <div
          style={{
            padding: `${24 * u}px ${54 * u}px`,
            borderRadius: 999,
            background: C.slop,
            color: C.slopInk,
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 70 * u,
            transform: `translateY(${pressed ? 8 * u : 0}px)`,
            boxShadow: pressed ? "none" : `0 ${8 * u}px 0 #5d8f12`,
          }}
        >
          Post to 7 accounts
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${portrait ? 2 : 3}, ${(portrait ? 440 : 500) * u}px)`,
            gap: 26 * u,
          }}
        >
          {cards.map((network, index) => {
            const at = press + 6 + Math.round(index * (BEAT / 2));
            const enter = interpolate(frame, [at, at + 7], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const posted = frame >= at + 10;
            return (
              <div
                key={network.name}
                style={{
                  background: "#fff",
                  borderRadius: 22 * u,
                  padding: 20 * u,
                  opacity: enter,
                  transform: `translateY(${(1 - enter) * 80 * u}px) rotate(${(1 - enter) * (index % 2 ? 6 : -6)}deg)`,
                  fontFamily: SANS,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 * u }}>
                  <Badge network={network} size={46 * u} />
                  <div style={{ fontWeight: 800, fontSize: 26 * u, flex: 1 }}>{network.name}</div>
                  {posted && <Check size={36 * u} color="#3c7a0d" />}
                </div>
                <div style={{ marginTop: 10 * u, fontSize: 22 * u, lineHeight: 1.3, color: C.muted }}>
                  {network.name === "X" ? "Tiltmaze 2.0: 40 new levels + a level editor 🎱" : POST.slice(0, 64) + "…"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Caption at={beat(11, 0)}>Now, at your best times, or one at a time. Nothing posts twice.</Caption>
    </Scene>
  );
}

function Promote() {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const from = bar(12);
  const launched = beat(12, 2);
  const clicks = [
    { network: net("X"), value: 412 },
    { network: net("LinkedIn"), value: 268 },
    { network: net("Reddit"), value: 197 },
    { network: net("Bluesky"), value: 121 },
  ];
  const grow = interpolate(frame, [beat(13, 1), beat(14, 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const card = useEnter(from + 4, 12);
  return (
    <Scene from={from} to={bar(15)} light>
      <Step at={from} n="3" title="Promote your slops" light />
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", gap: 50 * u, alignItems: "center" }}>
        <Panel width={(portrait ? 900 : 700) * u} style={{ transform: `scale(${card})` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 * u }}>
            <div
              style={{
                width: 110 * u,
                height: 110 * u,
                borderRadius: 24 * u,
                background: "linear-gradient(135deg,#7c3aed,#ec4899 55%,#f59e0b)",
              }}
            />
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 60 * u }}>Tiltmaze 2.0</div>
              <div style={{ fontSize: 26 * u, color: C.muted }}>Tilt your phone to roll the ball home</div>
            </div>
          </div>
          <div
            style={{
              marginTop: 24 * u,
              display: "flex",
              alignItems: "center",
              gap: 14 * u,
              fontWeight: 800,
              fontSize: 30 * u,
              color: frame >= launched ? "#3c7a0d" : C.ink,
            }}
          >
            {frame >= launched ? <Check size={34 * u} color="#3c7a0d" /> : "○"} Launched on the wall
          </div>
          <div style={{ marginTop: 10 * u, display: "flex", gap: 10 * u, alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 26 * u, color: C.muted }}>Auto-posted to</span>
            {["X", "LinkedIn", "Bluesky", "Reddit"].map((name, index) => (
              <div key={name} style={{ opacity: frame >= launched + 6 + index * 4 ? 1 : 0.15 }}>
                <Badge network={net(name)} size={44 * u} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel width={(portrait ? 900 : 640) * u}>
          <div style={{ fontWeight: 800, fontSize: 32 * u }}>Clicks on your tracked link</div>
          <div style={{ display: "grid", gap: 16 * u, marginTop: 18 * u }}>
            {clicks.map(({ network, value }) => (
              <div key={network.name} style={{ display: "flex", alignItems: "center", gap: 14 * u }}>
                <Badge network={network} size={44 * u} />
                <div
                  style={{
                    height: 34 * u,
                    width: (value / 412) * grow * 340 * u,
                    background: network.color,
                    borderRadius: 8 * u,
                  }}
                />
                <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 28 * u }}>{Math.round(value * grow)}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Caption at={beat(13, 2)} light>
        Launch, and your accounts post it for you. See which network sends people.
      </Caption>
    </Scene>
  );
}

function Manage() {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const from = bar(15);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const posts = [
    { day: 0, slot: 0, network: net("X") },
    { day: 0, slot: 1, network: net("LinkedIn") },
    { day: 1, slot: 0, network: net("Instagram") },
    { day: 2, slot: 0, network: net("Threads") },
    { day: 2, slot: 1, network: net("YouTube") },
    { day: 3, slot: 0, network: net("Bluesky") },
    { day: 4, slot: 0, network: net("TikTok") },
    { day: 4, slot: 1, network: net("Reddit") },
    { day: 5, slot: 0, network: net("Mastodon") },
    { day: 6, slot: 0, network: net("Facebook") },
  ];
  const count = (to: number) =>
    Math.round(
      to *
        interpolate(frame, [beat(16, 2), beat(17, 2)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    );
  const stats = [
    { label: "Views", value: `${(count(184) / 10).toFixed(1)}K` },
    { label: "Likes", value: String(count(1033)) },
    { label: "Replies", value: String(count(91)) },
  ];
  const visibleDays = portrait ? days.slice(0, 4) : days;
  return (
    <Scene from={from} to={bar(18)} light>
      <Step at={from} n="4" title="Run all your social" light />
      <div style={{ display: "flex", flexDirection: "column", gap: 34 * u, alignItems: "center", marginTop: 60 * u }}>
        <Panel width={(portrait ? 960 : 1500) * u}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${visibleDays.length}, 1fr)`, gap: 12 * u }}>
            {visibleDays.map((day, index) => (
              <div key={day} style={{ background: C.sunk, borderRadius: 14 * u, padding: 12 * u, minHeight: 210 * u }}>
                <div style={{ fontWeight: 800, fontSize: 26 * u }}>{day}</div>
                {posts
                  .filter((post) => post.day === index)
                  .map((post, n) => {
                    const at = from + 6 + (post.day * 2 + post.slot) * 3;
                    const enter = interpolate(frame, [at, at + 6], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    });
                    return (
                      <div
                        key={n}
                        style={{
                          marginTop: 10 * u,
                          display: "flex",
                          alignItems: "center",
                          gap: 8 * u,
                          background: "#fff",
                          borderRadius: 10 * u,
                          padding: 8 * u,
                          opacity: enter,
                          transform: `scale(${0.8 + enter * 0.2})`,
                        }}
                      >
                        <Badge network={post.network} size={34 * u} />
                        <span style={{ fontFamily: MONO, fontSize: 20 * u }}>{post.slot ? "17:30" : "09:00"}</span>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </Panel>
        <div style={{ display: "flex", gap: 24 * u }}>
          {stats.map((stat) => (
            <Panel key={stat.label} width={(portrait ? 290 : 330) * u} style={{ textAlign: "center", padding: 22 * u }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 76 * u }}>{stat.value}</div>
              <div style={{ fontWeight: 700, fontSize: 26 * u, color: C.muted }}>{stat.label}</div>
            </Panel>
          ))}
        </div>
      </div>
      <Caption at={beat(16, 0)} light>
        Ideas, drafts, a queue, a calendar, comments and stats from every network, in one place.
      </Caption>
    </Scene>
  );
}

function Price() {
  const { u, portrait } = useLayout();
  const from = bar(18);
  const sub = useEnter(beat(19, 0), 14);
  return (
    <Scene from={from} to={bar(20)}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 * u }}>
        <FlapText text="FREE" start={from - 12} size={(portrait ? 220 : 240) * u} tone="lime" />
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: (portrait ? 46 : 52) * u,
            color: C.boardInk,
            textAlign: "center",
            maxWidth: 1300 * u,
            opacity: sub,
            transform: `translateY(${(1 - sub) * 24 * u}px)`,
            lineHeight: 1.3,
          }}
        >
          The only cost is X: it bills your own X app
          <br />
          about $0.015 a post.
        </div>
      </div>
    </Scene>
  );
}

export function StudioDemo() {
  const frame = useCurrentFrame();
  // The track is mastered hot; this leaves headroom, and it fades out with the end card.
  const volume = (at: number) =>
    interpolate(at, [STUDIO_FRAMES - 24, STUDIO_FRAMES], [0.72, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return (
    <AbsoluteFill style={{ background: C.board }}>
      <Audio src={staticFile("music-keeping-fit.mp3")} volume={volume} />
      <Hook />
      <Networks />
      <Setup />
      <Compose />
      <Send />
      <Promote />
      <Manage />
      <Price />
      {frame >= bar(20) && (
        <AbsoluteFill>
          <EndCard start={bar(20)} address="slopper.day/studio" tagline="Slopper Studio: post once, everywhere." />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
