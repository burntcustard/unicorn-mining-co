import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    waveform: 'triangle',
    volume: 0.027,
    attack: 0.7,
    decay: 10,
    release: 6,
    frequency: 1630,
    cutoff: 10600,
  },
  {
    volume: 0.076,
    attack: 3,
    decay: 71,
    sustain: 0.14,
    release: 35,
    releaseCurve: 'linear',
    frequency: 900,
    delay: 0.7,
  },
  {
    waveform: 'triangle',
    volume: 0.054,
    attack: 6,
    decay: 53,
    sustain: 0.19,
    release: 31,
    releaseCurve: 'linear',
    frequency: 1350,
    cutoff: 7600,
    delay: 5,
  },
] satisfies SoundEffect[];
