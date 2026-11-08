import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.1,
    frequency: 660,
    attack: 10,
    decay: 100,
    endFrequency: 1000,
  },
] satisfies SoundEffect[];
