import type { EngineSoundSettings } from '../../client/audio/synthesis';

export default {
  duration: 1000,
  frequency: 22,
  fundamental: 0.5,
  secondHarmonic: 0.3,
  thirdHarmonic: 0.2,
  motorVolume: 0.4,
  noiseSmoothing: 0.02,
  noiseFilter: 0.02,
  noiseVolume: 0.6,
  noisePulse: 0.4,
  basePitch: 0.7,
  revRange: 1.2,
  idleVolume: 0.24,
  volume: 0.5,
  ramp: 1200,
} satisfies EngineSoundSettings;
