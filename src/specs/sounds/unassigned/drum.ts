import type { SoundEffect } from '../../../client/audio/synthesis';

/**
 * Approximate reconstruction of the commented drum preset in commit 3997cc3b:
 * [90, 135, .16, .29, 0, 1500, .006, 420, 8, .022].
 * The tuple does not match that commit's renderer. Infer start/end pitch,
 * total duration, volume, sine shape, low-pass start, attack, low-pass end,
 * high-pass cutoff, and pitch sweep duration, using seconds and hertz.
 */
export default {
  volume: 0.29,
  waveform: 'sine',
  frequency: 90,
  endFrequency: 135,
  pitchDuration: 22,
  attack: 6,
  decay: 154,
  cutoff: 1500,
  endCutoff: 420,
  filterCurve: 'exponential',
  highpass: 8,
} satisfies SoundEffect;
