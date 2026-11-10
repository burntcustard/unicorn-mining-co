import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.05,
    attack: 1,
    decay: 45,
    release: 10,
    cutoff: 8000,
    highpass: 80,
  },
  {
    volume: 0.01,
    attack: 2,
    decay: 65,
    release: 8,
    frequency: 260,
    endFrequency: 91,
    pitchDuration: 65,
    pitchCurve: 'ease-out',
    highpass: 170,
  },
  {
    volume: 0.03,
    attack: 1,
    decay: 53,
    delay: 11,
    release: 12,
    waveform: 'crackle',
    frequency: 5800,
    cutoff: 13000,
    highpass: 800,
    resonance: 5100,
    ring: 3,
  },
] satisfies SoundEffect[];
