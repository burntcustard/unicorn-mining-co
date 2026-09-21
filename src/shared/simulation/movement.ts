import { type Vector } from '../../vector';

const maxSpeedDrag = 0.9;

/**
 * Carry an entity along by its velocity and apply the game's standard drag.
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
