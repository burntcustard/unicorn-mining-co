import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.027,
    attack: 0.7,
    decay: 10,
    release: 6,
    waveform: 'triangle',
    frequency: 1630,
    cutoff: 10600,
  },
  {
    volume: 0.076,
    attack: 3,
    decay: 71,
    delay: 1,
    release: 35,
    sustain: 0.14,
    releaseCurve: 'linear',
    frequency: 900,
  },
  {
    volume: 0.054,
    attack: 6,
    decay: 53,
    delay: 5,
    release: 31,
    sustain: 0.19,
    releaseCurve: 'linear',
    waveform: 'triangle',
    frequency: 1350,
    cutoff: 7600,
  },
] satisfies SoundEffect[];
