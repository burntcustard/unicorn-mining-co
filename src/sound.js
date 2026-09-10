/**
 * Sounds are plain Web Audio oscillators rather than generated sample buffers.
 * A running oscillator has no loop point, so there is no seam to click at, and
 * anything about a playing sound is changed by ramping one of its params.
 * A looped buffer sounded fine loud but crackly quiet: its seam is broadband
 * while its fundamental is low enough that quietening it takes the tone below
 * audibility long before it takes the clicks with it.
 */
let audio = 0;

// Must run synchronously inside a real user gesture (keydown/click) to count
// as one for autoplay purposes - a rAF-driven call a frame later is too late
// for some browsers (Firefox in particular), which then leave the context
// suspended forever with no error, so start() silently does nothing.
export const unlockAudio = () => {
  audio ||= new AudioContext();
  audio.resume();
};

// Long enough that a change never clicks, short enough that the drill biting
// into rock is heard as it happens rather than swelling in afterwards
const rampTime = 0.1;

/**
 * Slide an AudioParam to a value from wherever it is now - jumping straight
 * there clicks, and so does stopping a sound mid-wave. The ramp is anchored a
 * little ahead of the clock because the audio thread has already rendered
 * past it, and an event landing in that gap is skipped rather than played,
 * which pops the front off a fade in.
 *
 * @returns {number} The audio-clock time the ramp lands on that value.
 */
export const ramp = (param, value) => {
  const time = audio.currentTime + rampTime;

  param.cancelScheduledValues(time);
  param.setValueAtTime(param.value, time);
  param.linearRampToValueAtTime(value, time + rampTime);

  return time + rampTime;
};

/**
 * Start a sound, silent: the caller ramps `gain` up to the level it wants, and
 * can go on ramping it for as long as the sound plays.
 *
 * The tone is chopped in and out of silence at its own pitch by a second
 * oscillator, which is what makes it purr like a running motor rather than
 * hum like a held note - every chop then contains the same stretch of
 * waveform, so it repeats steadily instead of drifting in and out of phase.
 */
export const tone = (frequency, type) => {
  unlockAudio();

  const oscillator = audio.createOscillator();
  const pulse = audio.createOscillator();
  const depth = audio.createGain();
  const chop = audio.createGain();
  const gain = audio.createGain();

  oscillator.type = pulse.type = type;
  oscillator.frequency.value = pulse.frequency.value = frequency;
  // An oscillator always swings a full -1 to 1, so its reach is set on the way
  depth.gain.value = chop.gain.value = 0.5;

  pulse.connect(depth);
  depth.connect(chop.gain);
  oscillator.connect(chop);
  chop.connect(gain);
  gain.connect(audio.destination);

  oscillator.gain = gain.gain;
  oscillator.gain.value = 0;
  oscillator.start();
  pulse.start();

  const stop = oscillator.stop.bind(oscillator);

  // Use the audio clock so the native stops stay on the end of the fade out.
  oscillator.stop = () => {
    const time = ramp(oscillator.gain, 0);

    pulse.stop(time);
    stop(time);
  };

  return oscillator;
};

// @ifdef DEBUG
// An audible beep, for telling "Web Audio doesn't work at all here" apart from
// "the game's sounds specifically are wrong".
export const testTone = () => {
  const sound = tone(440, 'sine');

  ramp(sound.gain, 0.5);
  setTimeout(() => sound.stop(), 1000);
};
// @endif
