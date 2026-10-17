/**
 * Reviews rendered promos: a contact sheet of frames across each video, and
 * its streams and loudness, so silence, clipping or a missing track shows up.
 *
 *   node scripts/review.ts out/board-landscape.mp4 [...]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { basename } from "node:path";

for (const file of process.argv.slice(2)) {
  const probe = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], {
      encoding: "utf8",
    }),
  ) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      sample_rate?: string;
      channels?: number;
    }[];
    format: { duration: string; size: string };
  };
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  // ffmpeg prints its loudness analysis on stderr.
  const report = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=framelog=quiet,volumedetect", "-f", "null", "-"],
    {
      encoding: "utf8",
    },
  ).stderr;
  const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(report)?.[1];
  const peak = /max_volume: (-?[\d.]+) dB/.exec(report)?.[1];
  const mean = /mean_volume: (-?[\d.]+) dB/.exec(report)?.[1];
  const duration = Number(probe.format.duration);
  console.log(
    `${basename(file)}: ${video?.width}x${video?.height} ${video?.codec_name}, ${duration.toFixed(2)} s, ${(Number(probe.format.size) / 1_048_576).toFixed(1)} MB, ` +
      (audio
        ? `audio ${audio.codec_name} ${audio.sample_rate} Hz x${audio.channels}, ${integrated} LUFS, peak ${peak} dB, mean ${mean} dB`
        : "NO AUDIO"),
  );
  // Ten frames across the video, tiled.
  const portrait = (video?.height ?? 0) > (video?.width ?? 0);
  const fps = 10 / duration;
  const scale = portrait ? "216:384" : "384:216";
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    file,
    "-vf",
    `fps=${fps},scale=${scale},tile=5x2`,
    "-frames:v",
    "1",
    file.replace(/\.mp4$/, "-sheet.png"),
  ]);
}
