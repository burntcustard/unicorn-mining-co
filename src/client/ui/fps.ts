import { renderText } from './text';
import { type GameState } from '../game';

// How long a reading stands before it is worked out again. Any faster and it
// is a blur of digits rather than something readable
const settle = 200;

let enabled = true;
let since: number | undefined;
let frames = 0;
let rate = 0;

export const toggleFps = () => {
  enabled = !enabled;
  since = undefined;
  frames = 0;
  rate = 0;
};

/**
 * Frames counted over the last 200 ms rather than taken from the gap
 * between the last two, so that one slow frame does not throw the number.
 */
export const renderFps = ({ game, x }: { game: GameState; x: number }) => {
  if (!enabled) return;
  const now = performance.now();

  since ??= now;
  frames++;

  if (now - since >= settle) {
    rate = Math.round((frames * 1000) / (now - since));
    since = now;
    frames = 0;
  }

  renderText({ game, text: `FPS:${rate}`, x, y: 20, size: 1 });
};
