import * as Vec from '../vector';

/**
 * Create a finite, symmetrical Vec.Value transition with zero velocity at both
 * ends. The returned updater retains its elapsed time; call it on every game
 * update with that update's duration in seconds to receive the current Vec.Value.
 */
export const ease = ({
  duration = 1,
  from = Vec.create(),
  to = Vec.create(),
}) => {
  let elapsed = 0;
  const start = Vec.clone(from);

  return (dt = 0) => {
    const progress = Math.min(1, (elapsed += dt) / duration);
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;

    return Vec.addScaled(start, Vec.subtract(to, start), eased);
  };
};
