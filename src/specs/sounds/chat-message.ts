import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    waveform: 'sine',
    volume: 0.079,
    frequency: 800,
    endFrequency: 800,
    attack: 3,
    decay: 85,
    release: 8,
    pitchDuration: 85,
    pitchCurve: 'ease-out',
  },
  {
    waveform: 'sine',
    volume: 0.062,
    frequency: 1200,
    endFrequency: 1200,
    attack: 4,
    decay: 110,
    release: 8,
    pitchDuration: 90,
    pitchCurve: 'ease-out',
    delay: 70,
  },
  {
    waveform: 'sine',
    volume: 0.022,
    frequency: 2280,
    endFrequency: 2280,
    attack: 2,
    decay: 18,
    release: 8,
    pitchDuration: 18,
    pitchCurve: 'ease-out',
  },
] satisfies SoundEffect[];
