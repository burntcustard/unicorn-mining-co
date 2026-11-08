# Sound analysis workflow

## Compare and revise

Set `TOOLS="$PWD/src/tools/sound-analysis"` from the repository root and
`WORK="$(mktemp -d)"` for drafts and outputs.

```sh
node "$TOOLS/audit.ts" "$BEFORE" "$AFTER"
node "$TOOLS/compare.ts" "$BEFORE" "$AFTER" --png "$WORK/comparison.png"
node "$TOOLS/audit.ts" "$AFTER" --repeat-ms 50 --repeat-wav "$WORK/repeat.wav"
```

- Check peak and RMS for level changes, the strongest frequency bin for
  dominant tones, energy below 200 Hz for bass, and energy at or above 4 kHz
  for brightness. The plot uses a shared level scale, time from left to
  right (about 5 ms per four pixels), and low frequencies at the bottom.
  Panels follow command order from top to bottom.
- Check 99% energy time, energy after the repeat interval, and the peak of
  eight overlapping hits for tail changes. Listen to the complete cue and
  the repeat WAV. A peak above 1 can clip at full gain. For noise or crackle,
  repeat the audit with different `--seed` values.
- Delay, envelope stages, ring, and sweep timing use milliseconds. Sweep
  durations are separate from envelope length. Zero low-pass bypasses the filter.
  Set tonal waveforms explicitly when adding a nonzero initial low-pass.
  Defaults live in `src/client/audio/synthesis.ts` and editor ranges in
  `src/tools/sound-editor/parameters.ts`.

## Work from a recording

Use a short, isolated gesture with a little pre-onset ambience. When using a
video, identify the action from the footage and confirm the sound on another
occurrence if possible. Keep music, speech, and adjacent actions out of the
clip. Use local `yt-dlp` and FFmpeg for authorized media.

```sh
yt-dlp --js-runtimes node --no-playlist -f bestaudio \
  -o "$WORK/source.%(ext)s" "$URL"
ffmpeg -ss "$CLIP_START" -i "$AUDIO_FILE" -t "$CLIP_SECONDS" -vn \
  -ac 1 -ar 44100 -c:a pcm_f32le -f f32le -n "$WORK/reference.f32"
```

Use seconds for the FFmpeg times and milliseconds for `--onset`, measured
from the start of the extracted clip. Set `AUDIO_FILE` to the downloaded
file. The tools accept clips up to 10 seconds in mono 44.1 kHz little-endian
float32 PCM. Pass just the reference and `--png` to `compare.ts` to locate its
onset before fitting.

```sh
node "$TOOLS/compare.ts" "$WORK/reference.f32" "$BASE" --onset 30
node "$TOOLS/fit.ts" "$WORK/reference.f32" "$BASE" "$WORK/fit.json" --onset 30
node "$TOOLS/compare.ts" "$WORK/reference.f32" "$BASE" "$WORK/fit.json" \
  --onset 30 --png "$WORK/fit.png"
```

The fitter adjusts authored numeric values within editor ranges while
preserving the supplied layers and waveforms. Start with a spec that has
the right kinds of layers. The score compares full-duration spectral levels
above a floor estimated from the pre-onset audio. Smaller means closer on
that measurement. Clip alignment, background, and recording level affect
the score. Choose a reference gain deliberately and keep it fixed across
comparisons. Check the plot, headroom, and tails before promoting a fit to
a procedural spec. Judge perceptual similarity by listening.
