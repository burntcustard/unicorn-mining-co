import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.002,
    attack: 50,
    decay: 900,
    release: 50,
    sustain: 1,
    cutoff: 425,
    highpass: 70,
    resonance: 110,
    ring: 20,
  },
] satisfies SoundEffect[];
