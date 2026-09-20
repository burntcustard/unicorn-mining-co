import { Vector } from './vector';

/**
 * Create a finite, symmetrical Vector transition with zero velocity at both
 * ends. The returned updater retains its elapsed time; call it on every game
 * update with that update's duration in seconds to receive the current Vector.
 */
export const ease = ({ duration = 1, from = Vector(), to = Vector() }) => {
  let elapsed = 0;
  const start = Vector(from.x, from.y);

  return (dt = 0) => {
    const progress = Math.min(1, (elapsed += dt) / duration);
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;

    return start.add(to.subtract(start).scale(eased));
  };
};
