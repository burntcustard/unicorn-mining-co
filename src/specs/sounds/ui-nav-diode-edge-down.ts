import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.169,
    attack: 0.65,
    decay: 8,
    release: 4,
    waveform: 'pulse',
    pulseWidth: 0.19,
    frequency: 1740,
    endFrequency: 1990,
    pitchDuration: 7,
    pitchCurve: 'ease-out',
    cutoff: 11600,
    highpass: 900,
  },
  {
    volume: 0.207,
    attack: 0.9,
    decay: 18,
    delay: 1,
    release: 9,
    sustain: 0.09,
    releaseCurve: 'linear',
    waveform: 'triangle',
    frequency: 1544,
    cutoff: 10000,
    highpass: 490,
  },
] satisfies SoundEffect[];
