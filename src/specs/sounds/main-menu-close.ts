import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.06,
    attack: 2,
    decay: 75,
    release: 8,
    frequency: 1020,
  },
  {
    volume: 0.065,
    attack: 2,
    decay: 95,
    delay: 48,
    release: 8,
    waveform: 'triangle',
    frequency: 680,
    cutoff: 5000,
  },
  {
    volume: 0.01,
    attack: 0.65,
    decay: 8,
    delay: 60,
    release: 4,
    waveform: 'pulse',
    pulseWidth: 0.19,
    frequency: 1990,
    endFrequency: 1740,
    pitchDuration: 7,
    pitchCurve: 'ease-out',
    cutoff: 11600,
    highpass: 900,
  },
] satisfies SoundEffect[];
