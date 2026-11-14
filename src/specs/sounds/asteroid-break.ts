import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 1.5,
    frequency: 75,
    attack: 10,
    decay: 200,
    endFrequency: 18,
    highpass: 45,
  },
] satisfies SoundEffect[];
