import * as Vec from '../utilities/vector';

/**
 * Other craft sounds start at half volume and fade with distance outside the
 * viewport, reaching silence half its shorter dimension beyond the edge.
 */
export const remoteSoundVolume = ({
  position,
  view,
  width,
  height,
}: {
  position: Vec.Value;
  view: Vec.Value;
  width: number;
  height: number;
}) => {
  const distance = Math.hypot(
    Math.max(view.x - position.x, 0, position.x - view.x - width),
    Math.max(view.y - position.y, 0, position.y - view.y - height),
  );

  return 0.5 * Math.max(0, 1 - distance / (Math.min(width, height) / 2));
};
