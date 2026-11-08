import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.312,
    attack: 0,
    decay: 0,
    hold: 3,
    release: 12,
    sustain: 1,
    cutoff: 18000,
    highpass: 1902,
  },
  {
    volume: 0.234,
    attack: 2,
    decay: 15,
    delay: 64,
    cutoff: 12500,
    highpass: 1791,
  },
  {
    volume: 0.062,
    attack: 3,
    decay: 100,
    release: 5,
    frequency: 3648,
    endFrequency: 2784,
    pitchDuration: 65,
  },
] satisfies SoundEffect[];
