import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 2,
    frequency: 75,
    attack: 10,
    decay: 200,
    endFrequency: 18,
    highpass: 30,
  },
] satisfies SoundEffect[];
