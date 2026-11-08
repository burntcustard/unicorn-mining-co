import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.175,
    frequency: 800,
    attack: 3,
    decay: 92,
  },
  {
    volume: 0.115,
    frequency: 1290,
    attack: 1,
    decay: 27,
  },
  {
    volume: 0.09,
    frequency: 2280,
    attack: 1,
    decay: 14,
  },
  {
    volume: 0.05,
    frequency: 3445,
    attack: 1,
    decay: 8,
  },
] satisfies SoundEffect[];
