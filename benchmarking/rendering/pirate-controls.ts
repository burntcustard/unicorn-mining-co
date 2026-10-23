import * as Vec from '../../src/client/utilities/vector.ts';
import { emptyPlayerInput } from '../../src/client/protocol/input.ts';

type CombatShip = {
  id: number;
  position: Vec.Value;
  velocity: Vec.Value;
  rotation: number;
  spin: number;
  radius: number;
};

/*
 * Steering uses the same discrete keys as the public binary protocol.
 */
export function keyboardSteering({
  ship,
  angle,
  thrust = true,
}: {
  ship: Pick<CombatShip, 'rotation' | 'spin'>;
  angle: number;
  thrust?: boolean;
}) {
  const error = Math.atan2(
    Math.sin(angle - ship.rotation),
    Math.cos(angle - ship.rotation),
  );
  const desiredSpin = Math.max(-2.2, Math.min(2.2, error * 3));

  return {
    turn:
      Math.abs(desiredSpin - ship.spin) < 0.08
        ? 0
        : Math.sign(desiredSpin - ship.spin),
    thrust: Number(thrust && Math.abs(error) < 0.4),
  };
}

/*
 * Drive the local Courser with real keyboard values. Prediction and the binary
 * protocol must see identical controls; fractional NPC steering is not a key.
 */
export function pirateControls({
  ship,
  target,
  asteroids,
}: {
  ship: CombatShip;
  target?: CombatShip;
  asteroids: { position: Vec.Value; radius: number }[];
}) {
  const input = emptyPlayerInput();

  input.autogunActive = true;

  if (!target) return input;
  const offset = Vec.subtract(target.position, ship.position);
  const distance = Vec.length(offset);
  const direction = Vec.normalize(offset);
  const lead = Vec.addScaled(
    target.position,
    Vec.subtract(target.velocity, ship.velocity),
    Math.min(1, distance / 1000),
  );

  // Fly past a nearby opponent instead of stopping nose-to-nose. The server
  // pirates retain their ordinary persistent Go navigation and attack runs.
  let destination =
    distance < 260
      ? Vec.add(
          target.position,
          Vec.scale(Vec.create(-direction.y, direction.x), 300),
        )
      : target.position;
  const route = Vec.subtract(destination, ship.position);
  const routeDirection = Vec.normalize(route);
  let nearest = Infinity;

  for (const rock of asteroids) {
    const relative = Vec.subtract(rock.position, ship.position);
    const along = Vec.dot(relative, routeDirection);
    const clearance = rock.radius + ship.radius + 45;

    if (along < 0 || along > Math.min(Vec.length(route), clearance + 300)) {
      continue;
    }

    const lateral = Vec.subtract(relative, Vec.scale(routeDirection, along));

    if (Vec.length(lateral) >= clearance || along >= nearest) continue;
    nearest = along;
    const side =
      Vec.dot(relative, Vec.create(-routeDirection.y, routeDirection.x)) >= 0
        ? -1
        : 1;

    destination = Vec.addScaled(
      rock.position,
      Vec.create(-routeDirection.y * side, routeDirection.x * side),
      clearance + 100,
    );
  }

  const steering = Vec.subtract(destination, ship.position);
  const angle = Math.atan2(steering.y, steering.x);

  Object.assign(input, keyboardSteering({ ship, angle }));
  const aim =
    Math.atan2(lead.y - ship.position.y, lead.x - ship.position.x) -
    ship.rotation;

  input.fire =
    distance < 700 && Math.abs(Math.atan2(Math.sin(aim), Math.cos(aim))) < 0.12;
  return input;
}
