import { type Vector } from './vector';

// How much of excess speed a thing keeps each sixtieth of a second while it
// settles back to its top speed. Steep, so a launch or road fling is brief.
const maxSpeedDrag = 0.9;

/**
 * Carry a thing along by the speed it already has, dragging it back towards a
 * stop as it goes. Everything that moves does this and does it the same way,
 * whether it flies itself or was only ever shoved: the difference is in what
 * put speed into it beforehand, not in what happens to that speed afterwards.
 *
 * @param object Anything with a place and a velocity.
 * @param dt Seconds since the last update.
 */
export const move = (
  {
    position,
    velocity,
    drag = 0.15,
    maxSpeed = 272,
  }: {
    position: Vector;
    velocity: Vector;
    drag?: number;
    maxSpeed?: number;
  },
  dt: number,
) => {
  const speed = velocity.length();

  if (speed < 1) velocity.x = velocity.y = 0;

  const kept =
    speed > maxSpeed
      ? Math.max(maxSpeed, speed * maxSpeedDrag ** (dt * 60)) / speed
      : Math.exp(-drag * dt);

  velocity.x *= kept;
  velocity.y *= kept;

  position.set(position.add(velocity.scale(dt)));
};
