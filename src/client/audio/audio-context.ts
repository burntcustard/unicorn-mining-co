export let audio: AudioContext | 0 = 0;

/**
 * Open or resume the shared context during a user gesture, even when the
 * sound module is still loading.
 */
export const unlockAudio = () => {
  audio ||= new AudioContext();

  if (audio.state !== 'running') return audio.resume();
};
