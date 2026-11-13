import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.194,
    attack: 1,
    decay: 45,
    release: 12,
    waveform: 'crackle',
    frequency: 1800,
    cutoff: 13000,
    highpass: 800,
    resonance: 5074,
    ring: 3,
  },
  {
    volume: 0.035,
    attack: 2,
    decay: 150,
    release: 8,
    frequency: 2326,
    endFrequency: 1249,
    pitchDuration: 90,
    pitchCurve: 'ease-out',
  },
  {
    volume: 0.04,
    attack: 2,
    decay: 165,
    delay: 18,
    release: 8,
    frequency: 1249,
    endFrequency: 800,
    pitchDuration: 140,
    pitchCurve: 'ease-out',
  },
] satisfies SoundEffect[];
