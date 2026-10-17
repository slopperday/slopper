/**
 * Finds where a track's musical moments land, in video frames, so cuts can
 * sit on them: the tempo, every beat and downbeat, and the biggest accents
 * (hits, drops, section changes).
 *
 *   node scripts/beats.ts public/track.mp3 [--fps 30] [--from 0] [--to 20]
 *
 * Onsets come from spectral flux (how much each band gets louder from one
 * 23 ms frame to the next); tempo from the autocorrelation of that onset
 * curve; the beat grid's phase from the offset that lines up best with it.
 */
import { execFileSync } from "node:child_process";

const RATE = 22_050;
const HOP = 512;
const SIZE = 1024;

const args = process.argv.slice(2);
const file = args[0];
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const fps = option("fps", 30);
const from = option("from", 0);
const to = option("to", 600);
if (!file) throw new Error("Usage: node scripts/beats.ts <audio file> [--fps 30] [--from s] [--to s]");

const raw = execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-ss",
    String(from),
    "-t",
    String(to - from),
    "-i",
    file,
    "-ac",
    "1",
    "-ar",
    String(RATE),
    "-f",
    "f32le",
    "-",
  ],
  {
    maxBuffer: 512 * 1024 * 1024,
  },
);
const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));

// Magnitude spectrum per frame (a plain DFT on 32 log-spaced bands is plenty for onsets).
const frames = Math.floor((samples.length - SIZE) / HOP);
const BANDS = 32;
const window = Float32Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE));
const bandFreqs = Array.from({ length: BANDS }, (_, band) => 40 * (8000 / 40) ** (band / (BANDS - 1)));
const previous = new Float32Array(BANDS);
const profiles = new Float32Array(frames * BANDS);
const flux = new Float32Array(frames);
const energy = new Float32Array(frames);
for (let frame = 0; frame < frames; frame++) {
  const offset = frame * HOP;
  let total = 0;
  for (let band = 0; band < BANDS; band++) {
    const omega = (2 * Math.PI * bandFreqs[band]) / RATE;
    let re = 0;
    let im = 0;
    for (let i = 0; i < SIZE; i += 2) {
      const value = samples[offset + i] * window[i];
      re += value * Math.cos(omega * i);
      im -= value * Math.sin(omega * i);
    }
    const magnitude = Math.log1p(Math.hypot(re, im));
    profiles[frame * BANDS + band] = magnitude;
    const rise = magnitude - previous[band];
    if (rise > 0) flux[frame] += rise;
    previous[band] = magnitude;
    total += magnitude;
  }
  energy[frame] = total / BANDS;
}

const secondsPerFrame = HOP / RATE;
// Tempo: autocorrelation of the onset curve between 80 and 160 bpm.
const lag = (bpm: number) => 60 / bpm / secondsPerFrame;
function tempoScore(bpm: number): number {
  const period = lag(bpm);
  let score = 0;
  for (let frame = 0; frame + period * 8 < frames; frame++) {
    score +=
      flux[frame] *
      (flux[Math.round(frame + period)] +
        0.5 * flux[Math.round(frame + period * 2)] +
        0.5 * flux[Math.round(frame + period * 4)] +
        0.5 * flux[Math.round(frame + period * 8)]);
  }
  return score;
}
let best = { bpm: 120, score: -Infinity };
for (let bpm = 80; bpm <= 160; bpm += 0.25) {
  const score = tempoScore(bpm);
  if (score > best.score) best = { bpm, score };
}
// Then finer around it: a small tempo error drifts a frame every few seconds.
for (let bpm = best.bpm - 0.5; bpm <= best.bpm + 0.5; bpm += 0.02) {
  const score = tempoScore(bpm);
  if (score > best.score) best = { bpm: +bpm.toFixed(2), score };
}
const period = lag(best.bpm);

// Phase: the offset whose grid collects the most onset strength; the strongest of every four is the downbeat.
let phase = 0;
let phaseScore = -Infinity;
for (let offset = 0; offset < period; offset += 0.25) {
  let score = 0;
  for (let beat = offset; beat < frames; beat += period) score += flux[Math.round(beat)] ?? 0;
  if (score > phaseScore) {
    phaseScore = score;
    phase = offset;
  }
}
const beats: number[] = [];
for (let beat = phase; beat < frames; beat += period) beats.push(beat * secondsPerFrame);
/** How different the sound is in the beat after `index` from the beat before: chords change on the 1. */
function harmonicChange(index: number): number {
  const mean = (start: number, end: number) => {
    const sum = new Float32Array(BANDS);
    for (let frame = Math.max(0, Math.round(start)); frame < Math.min(frames, Math.round(end)); frame++) {
      for (let band = 0; band < BANDS; band++) sum[band] += profiles[frame * BANDS + band];
    }
    return sum;
  };
  const at = beats[index] / secondsPerFrame;
  const before = mean(at - period, at);
  const after = mean(at, at + period);
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let band = 0; band < BANDS; band++) {
    dot += before[band] * after[band];
    a += before[band] ** 2;
    b += after[band] ** 2;
  }
  return a && b ? 1 - dot / Math.sqrt(a * b) : 0;
}
const changeByBeat = beats.map((_, index) => (index === 0 ? 0 : harmonicChange(index)));
const fluxByBeat = beats.map((time) => flux[Math.round(time / secondsPerFrame)] ?? 0);
const normalise = (values: number[]) => {
  const top = Math.max(...values, 1e-9);
  return values.map((value) => value / top);
};
const change = normalise(changeByBeat);
const strength = normalise(fluxByBeat);
const downbeatShift = [0, 1, 2, 3]
  .map((shift) => ({
    shift,
    score: beats.reduce((sum, _, index) => sum + (index % 4 === shift ? 2 * change[index] + strength[index] : 0), 0),
  }))
  .sort((a, b) => b.score - a.score)[0].shift;

// Accents: the strongest onsets, at least half a second apart.
const accents = [...flux]
  .map((value, frame) => ({ value, time: frame * secondsPerFrame }))
  .sort((a, b) => b.value - a.value)
  .reduce<{ value: number; time: number }[]>(
    (kept, onset) => (kept.some((other) => Math.abs(other.time - onset.time) < 0.5) ? kept : [...kept, onset]),
    [],
  )
  .slice(0, 12)
  .sort((a, b) => a.time - b.time);

// Section changes: where the average energy of the next 2 s differs most from the last 2 s.
const span = Math.round(2 / secondsPerFrame);
const changes = [];
for (let frame = span; frame + span < frames; frame += Math.round(0.25 / secondsPerFrame)) {
  let before = 0;
  let after = 0;
  for (let i = 0; i < span; i++) {
    before += energy[frame - span + i];
    after += energy[frame + i];
  }
  changes.push({ time: frame * secondsPerFrame, jump: (after - before) / span });
}
const sections = changes
  .sort((a, b) => Math.abs(b.jump) - Math.abs(a.jump))
  .reduce<{ time: number; jump: number }[]>(
    (kept, change) => (kept.some((other) => Math.abs(other.time - change.time) < 2) ? kept : [...kept, change]),
    [],
  )
  .slice(0, 6)
  .sort((a, b) => a.time - b.time);

const toFrame = (seconds: number) => Math.round(seconds * fps);
console.log(
  JSON.stringify({
    file,
    window: [from, to],
    bpm: best.bpm,
    framesPerBeat: +((fps * 60) / best.bpm).toFixed(2),
    beats: beats.map(toFrame),
    downbeats: beats.filter((_, index) => index % 4 === downbeatShift).map(toFrame),
    accents: accents.map((accent) => ({ frame: toFrame(accent.time), strength: +accent.value.toFixed(2) })),
    sections: sections.map((section) => ({
      frame: toFrame(section.time),
      change: section.jump > 0 ? "louder" : "quieter",
      by: +section.jump.toFixed(3),
    })),
  }),
);
