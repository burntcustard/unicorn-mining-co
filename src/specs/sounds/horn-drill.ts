import type { HornDrillSoundSettings } from '../../client/audio/synthesis';

export default {
  duration: 33,
  frequency: 35,
  volume: 0.25,
  highpass: 30,
  basePitch: 0.4,
  activeVolume: 2,
  bitingVolume: 4,
  activePitch: 0.95,
  bitingPitch: 0.9,
  ramp: 1200,
} satisfies HornDrillSoundSettings;
