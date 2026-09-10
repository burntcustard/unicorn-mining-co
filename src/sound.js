/**
 * ZzFXMicro - Zuper Zmall Zound Zynth - v1.3.2 by Frank Force, edited by
 * burntcustard for size: only volume, randomness, frequency, attack, sustain,
 * release, shape and shapeCurve remain, and none of them default, so a sound
 * made with the full version at https://killedbyapixel.github.io/ZzFX/ needs
 * every other/trailing parameter dropped before it will work here.
 * https://github.com/KilledByAPixel/ZzFX
 * MIT License - Copyright 2026 Frank Force & burntcustard
 */
let zzfxX = 0;

// Must run synchronously inside a real user gesture (keydown/click) to count
// as one for autoplay purposes - a rAF-driven call a frame later is too late
// for some browsers (Firefox in particular), which then leave the context
// suspended forever with no error, so start() silently does nothing.
export const unlockAudio = () => {
  zzfxX ||= new AudioContext();
  zzfxX.resume();
};

export const zzfx = (
  volume,
  randomness,
  frequency,
  attack,
  sustain,
  release,
  shape,
  shapeCurve,
  fadeTime,
) => {
  unlockAudio();
  const sampleRate = 44100;

  if (randomness) frequency *= 1 + randomness * (2 * Math.random() - 1);
  // Phase is measured in cycles; only the sine wave needs radians.
  frequency /= sampleRate;

  // Separate locals let Terser fold a fixed preset without mutating its arguments.
  const attackSamples = attack * sampleRate;
  const sustainSamples = sustain * sampleRate;
  const releaseSamples = release * sampleRate;

  const length = attackSamples + sustainSamples + releaseSamples | 0;
  const source = zzfxX.createBufferSource();
  const gain = zzfxX.createGain();
  const buffer = zzfxX.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);

  // Fill the buffer before handing it to the source: assigning it first and
  // writing samples after leaves Firefox playing silence, since it appears to
  // snapshot the (still all-zero) buffer for its audio thread at assignment.
  channel.forEach((_, i) => {
    const t = frequency * i;

    const s = shape ? // wave shape
      shape > 1 ?
        shape > 2 ?
            (t % 1 < shapeCurve / 2) * 2 - 1 : // square
          1 - (2 * t % 2 + 2) % 2 : // saw
        1 - 4 * Math.abs(Math.round(t) - t) : // triangle
        Math.sin(t * Math.PI * 2); // sine

    channel[i] = s * volume * (i < attackSamples ? i / attackSamples : (length - i) / releaseSamples); // envelope
  });

  source.buffer = buffer;

  source.connect(gain);
  gain.connect(zzfxX.destination);

  // Caller-supplied so a looping sound can crossfade over the same time its
  // own activation/deactivation takes, rather than an arbitrary fixed length
  gain.gain.setValueAtTime(0, zzfxX.currentTime);
  gain.gain.linearRampToValueAtTime(1, zzfxX.currentTime + fadeTime);
  source.start();

  // stop() truncates the wave wherever it happens to be, which pops - fade
  // the gain to silence first, then stop once nothing is left to click.
  // Cancelling and re-anchoring first avoids a jump if stop() interrupts the
  // fade-in above before it has finished ramping up to 1
  const stop = source.stop.bind(source);

  source.stop = () => {
    const time = zzfxX.currentTime;

    gain.gain.cancelScheduledValues(time);
    gain.gain.setValueAtTime(gain.gain.value, time);
    gain.gain.linearRampToValueAtTime(0, time + fadeTime);
    setTimeout(stop, fadeTime * 1000);
  };

  return source;
};

// @ifdef DEBUG
// Bypasses our buffer-based zzfx entirely, to tell apart "Web Audio doesn't
// work at all here" from "something in our zzfx code specifically is broken".
export const testTone = () => {
  unlockAudio();

  const oscillator = zzfxX.createOscillator();

  oscillator.frequency.value = 440;
  oscillator.connect(zzfxX.destination);
  oscillator.start();
  setTimeout(() => oscillator.stop(), 1000);
};
// @endif
