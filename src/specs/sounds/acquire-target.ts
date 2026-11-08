import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.04,
    attack: 30,
    decay: 60,
    hold: 70,
    release: 270,
    sustain: 0.3,
    releaseCurve: 'ease-out',
    frequency: 1250,
  },
  {
    volume: 0.02,
    attack: 180,
    decay: 40,
    delay: 60,
    release: 150,
    sustain: 0.4,
    releaseCurve: 'ease-out',
    frequency: 2325,
  },
  {
    volume: 0.5,
    attack: 10,
    decay: 55,
    release: 20,
    sustain: 0.05,
    waveform: 'crackle',
    frequency: 2200,
    cutoff: 9000,
    highpass: 1500,
    resonance: 6950,
    ring: 5,
  },
] satisfies SoundEffect[];
