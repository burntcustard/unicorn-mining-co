import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.088,
    attack: 1,
    decay: 9,
    release: 10,
    cutoff: 14000,
    highpass: 1902,
  },
  {
    volume: 0.075,
    attack: 18,
    decay: 185,
    release: 8,
    frequency: 754,
    endFrequency: 800,
    pitchDuration: 120,
    pitchCurve: 'ease-out',
  },
  {
    volume: 0.04,
    attack: 12,
    decay: 150,
    delay: 55,
    release: 8,
    waveform: 'triangle',
    frequency: 1200,
  },
  {
    volume: 0.141,
    attack: 1,
    decay: 90,
    delay: 10,
    release: 12,
    waveform: 'crackle',
    frequency: 1800,
    cutoff: 13000,
    highpass: 800,
    resonance: 3413,
    ring: 3,
  },
] satisfies SoundEffect[];
