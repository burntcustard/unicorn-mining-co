/**
 * ZzFXMicro - Zuper Zmall Zound Zynth - v1.3.2 by Frank Force, edited by
 * burntcustard for size: only volume, randomness, frequency, attack, sustain,
 * release, shape and shapeCurve remain, and none of them default, so a sound
 * made with the full version at https://killedbyapixel.github.io/ZzFX/ needs
 * every other/trailing parameter dropped before it will work here.
 * https://github.com/KilledByAPixel/ZzFX
 * MIT License - Copyright 2026 Frank Force & burntcustard
 */
const zzfxX = new AudioContext();

export const zzfx = (
  volume,
  randomness,
  frequency,
  attack,
  sustain,
  release,
  shape,
  shapeCurve,
) => {
  const sampleRate = 44100;

  frequency *= (1 + randomness * 2 * Math.random() - randomness) * Math.PI * 2 / sampleRate;

  let t = 0;
  let s;
  const b = [];

  attack *= sampleRate;
  sustain *= sampleRate;
  release *= sampleRate;

  const length = attack + sustain + release | 0;

  for (let i = 0; i < length; b[i++] = s * volume) {
    s = shape ? // wave shape
      shape > 1 ?
        shape > 2 ?
            (t / Math.PI / 2 % 1 < shapeCurve / 2) * 2 - 1 : // square
          1 - (2 * t / Math.PI / 2 % 2 + 2) % 2 : // saw
        1 - 4 * Math.abs(Math.round(t / Math.PI / 2) - t / Math.PI / 2) : // triangle
        Math.sin(t); // sine

    s *= i < attack ? i / attack : (length - i) / release; // envelope

    t += frequency;
  }

  const source = zzfxX.createBufferSource();
  const buffer = zzfxX.createBuffer(1, b.length, sampleRate);
  const channel = buffer.getChannelData(0);

  b.forEach((sample, i) => channel[i] = sample);
  source.buffer = buffer;
  source.connect(zzfxX.destination);
  source.start();
  return source;
};
