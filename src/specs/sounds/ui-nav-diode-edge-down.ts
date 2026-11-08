import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    waveform: 'pulse',
    pulseWidth: 0.19,
    volume: 0.169,
    frequency: 1740,
    endFrequency: 1990,
    pitchDuration: 7,
    pitchCurve: 'ease-out',
    attack: 0.65,
    decay: 8,
    release: 4,
    cutoff: 11600,
    highpass: 900,
  },
  {
    waveform: 'triangle',
    volume: 0.207,
    frequency: 1543.5,
    delay: 1.3,
    attack: 0.9,
    decay: 18,
    sustain: 0.09,
    release: 9,
    releaseCurve: 'linear',
    cutoff: 10000,
    highpass: 490,
  },
] satisfies SoundEffect[];
