import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.079,
    attack: 3,
    decay: 85,
    release: 8,
    frequency: 800,
  },
  {
    volume: 0.062,
    attack: 4,
    decay: 110,
    delay: 70,
    release: 8,
    frequency: 1200,
  },
  {
    volume: 0.022,
    attack: 2,
    decay: 18,
    release: 8,
    frequency: 2280,
  },
] satisfies SoundEffect[];
