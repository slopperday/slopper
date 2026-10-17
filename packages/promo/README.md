# Slopper promo

The 24-second promo on Slopper's own slop (#0001), made with [Remotion](https://www.remotion.dev): the slogan, set a goal,
ship every day, win the day, let your agent ship it, and 7 apps in 7 days. Every cut lands on a bar of the music.

```sh
vp run --filter @slopperday/promo render            # out/slopper-promo.mp4, 1080×1920
vp run --filter @slopperday/promo render:landscape  # out/slopper-promo-landscape.mp4, 1920×1080
vp run --filter @slopperday/promo studio            # preview and scrub in the browser
```

Two scripts help with a new cut (they need `ffmpeg` on your PATH; rendering doesn't):

- `node scripts/beats.ts public/music-keeping-fit.mp3` prints a track's tempo, beats, downbeats and accents in frames.
  `BARS` in `src/VisionPromo.tsx` came from it, so re-run it if the music changes.
- `node scripts/review.ts out/slopper-promo.mp4` prints size, length and loudness, to catch silence or clipping.

Put a new render on the slop with `slopper video slopper out/slopper-promo.mp4`; it plays once it's approved. Keep it
under 4 MB (`LIMITS.videoBytes`).

## Licences

- Remotion is free for individuals and companies of up to three people ([remotion.dev/license](https://remotion.dev/license)).
- `public/music-keeping-fit.mp3`: "Keeping Fit" by Ahjay Stelino, from
  [Mixkit](https://mixkit.co/free-stock-music/chiptune/) under the Mixkit Stock Music Free License. It's free for
  commercial use without attribution, but can't be redistributed on its own, so it stays in this private repository.
- `public/flap.wav`: the split-flap clack, synthesised for these promos, so there's nothing to license.
- Fonts in `public/` are Big Shoulders, Schibsted Grotesk and Atkinson Hyperlegible Mono, under the SIL Open Font
  License (the same fonts as the site).
