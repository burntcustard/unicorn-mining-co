import { renderText } from './text';

// How long a reading stands before it is worked out again. Any faster and it
// is a blur of digits rather than something readable
const settle = 500;

let since = performance.now();
let frames = 0;
let rate = 0;

/**
 * Frames counted over the last half second rather than taken from the gap
 * between the last two, so that one slow frame does not throw the number.
 *
 * @param {Object} game
 */
export const renderFps = (game) => {
  const now = performance.now();

  frames++;

  if (now - since >= settle) {
    rate = Math.round((frames * 1000) / (now - since));
    since = now;
    frames = 0;
  }

  renderText({
    game,
    text: `FPS:${rate}`,
    x: 10,
    y: 70,
  });
};
