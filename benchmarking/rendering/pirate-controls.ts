import * as Vec from '../../src/client/utilities/vector.ts';
import { emptyPlayerInput } from '../../src/client/protocol/input.ts';
import { cannonSm } from '../../src/specs/modules/offense/cannon-sm.ts';

type CombatShip = {
  id: number;
  position: Vec.Value;
  velocity: Vec.Value;
  rotation: number;
  spin: number;
  radius: number;
  hullTargetPosition?: () => Vec.Value;
};

const headingError = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

export const createPiratePilot = () => ({
  targetId: 0,
  passBearing: 0,
  passUntil: 0,
  turnDirection: 0,
  turnSince: 0,
  reverseUntil: 0,
});

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
  const error = headingError(angle - ship.rotation);
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
  pilot,
  now = 0,
}: {
  ship: CombatShip & {
    mass: number;
    angularThrust: number;
    rotationalThrust: number;
  };
  target?: CombatShip;
  asteroids: { position: Vec.Value; radius: number }[];
  pilot?: ReturnType<typeof createPiratePilot>;
  now?: number;
}) {
  const input = emptyPlayerInput();

  input.autogunActive = true;

  if (!target) return input;
  input.targetId = target.id;

  const offset = Vec.subtract(target.position, ship.position);
  const distance = Vec.length(offset);
  const direction = Vec.normalize(offset);
  const aimOffset = Vec.subtract(
    target.hullTargetPosition?.() ?? target.position,
    ship.position,
  );
  const relativeVelocity = Vec.subtract(target.velocity, ship.velocity);
  const projectileSpeed = cannonSm.projectile.speed;
  const aimDistanceSquared = Vec.lengthSquared(aimOffset);
  const across = Vec.cross(aimOffset, relativeVelocity);
  const denominator =
    Math.sqrt(projectileSpeed ** 2 * aimDistanceSquared - across ** 2) -
    Vec.dot(aimOffset, relativeVelocity);
  const flight =
    denominator > 0
      ? aimDistanceSquared / denominator
      : Math.min(1, Math.sqrt(aimDistanceSquared) / projectileSpeed);

  Vec.addScaled(aimOffset, relativeVelocity, flight, aimOffset);

  const clearance = ship.radius + target.radius + 45;

  if (pilot && pilot.targetId !== target.id) {
    Object.assign(pilot, createPiratePilot(), { targetId: target.id });
  }

  const forward = Vec.create(Math.cos(ship.rotation), Math.sin(ship.rotation));

  if (
    pilot &&
    now >= pilot.passUntil &&
    distance < clearance &&
    Vec.dot(forward, direction) > 0.8 &&
    Vec.dot(Vec.subtract(ship.velocity, target.velocity), direction) > 20
  ) {
    const side =
      Math.sign(Vec.cross(direction, forward)) || Math.sign(ship.spin) || 1;

    pilot.passBearing = ship.rotation + side * 0.65;
    pilot.passUntil = now + 800;
  }

  const passing = pilot && now < pilot.passUntil;
  let destination = passing
    ? Vec.addScaled(
        ship.position,
        Vec.create(Math.cos(pilot.passBearing), Math.sin(pilot.passBearing)),
        400,
      )
    : target.position;
  const route = Vec.subtract(destination, ship.position);
  const routeDirection = Vec.normalize(route);
  const routeLength = Vec.length(route);
  const forwardLookahead = Math.max(120, Vec.length(ship.velocity) * 0.5);
  let clearAhead = true;
  let nearest = Infinity;

  for (const rock of asteroids) {
    const relative = Vec.subtract(rock.position, ship.position);
    const along = Vec.dot(relative, routeDirection);
    const rockClearance = rock.radius + ship.radius + 45;
    const ahead = Vec.dot(relative, forward);

    clearAhead &&= !(
      ahead >= 0 &&
      ahead < rockClearance + forwardLookahead &&
      Math.abs(Vec.cross(relative, forward)) < rockClearance
    );

    if (along < 0 || along > Math.min(routeLength, rockClearance + 300)) {
      continue;
    }

    const lateral = Vec.subtract(relative, Vec.scale(routeDirection, along));

    if (Vec.length(lateral) >= rockClearance || along >= nearest) continue;
    nearest = along;
    const side =
      Vec.dot(relative, Vec.create(-routeDirection.y, routeDirection.x)) >= 0
        ? -1
        : 1;

    destination = Vec.addScaled(
      rock.position,
      Vec.create(-routeDirection.y * side, routeDirection.x * side),
      rockClearance + 100,
    );
  }

  const steering = Vec.subtract(destination, ship.position);
  const bearing = Math.atan2(aimOffset.y, aimOffset.x);
  const aim = headingError(bearing - ship.rotation);
  const approaching = !passing && nearest === Infinity;

  Object.assign(
    input,
    keyboardSteering({
      ship,
      angle: approaching ? bearing : Math.atan2(steering.y, steering.x),
      thrust: !approaching || distance > clearance,
    }),
  );

  const angularAcceleration =
    (ship.rotationalThrust * ship.angularThrust) / ship.mass;

  if (approaching && angularAcceleration > 0) {
    const bearingRate =
      Vec.cross(aimOffset, relativeVelocity) /
      Math.max(1, Vec.lengthSquared(aimOffset));
    const relativeSpin = ship.spin - bearingRate;
    // A released turn key brakes the hull. Keep turning while that coast would fall short.
    const stoppingAngle =
      (relativeSpin * Math.abs(relativeSpin)) / (2 * angularAcceleration);
    const remaining = aim - stoppingAngle;

    input.turn = Math.abs(remaining) < 0.01 ? 0 : Math.sign(remaining);
  }

  input.fire = distance < 700 && Math.abs(aim) < 0.12;

  if (!clearAhead) {
    input.thrust = 0;
  } else if (nearest === Infinity && (!input.fire || passing)) {
    input.thrust = Number(
      distance > clearance ||
        Vec.dot(offset, forward) <= 0 ||
        Math.abs(Vec.cross(offset, forward)) >= ship.radius + target.radius,
    );
  }

  if (pilot && approaching && Math.abs(aim) > 0.4) {
    const turnDirection = Math.abs(ship.spin) > 0.35 ? Math.sign(ship.spin) : 0;

    if (now < pilot.reverseUntil) {
      input.turn = -pilot.turnDirection;
    } else if (turnDirection !== pilot.turnDirection) {
      pilot.turnDirection = turnDirection;
      pilot.turnSince = now;
    } else if (
      turnDirection &&
      now - pilot.turnSince > 2500 + (target.id % 11) * 130
    ) {
      pilot.reverseUntil = now + 650;
      pilot.turnSince = pilot.reverseUntil;
      input.turn = -turnDirection;
    }
  } else if (pilot) {
    pilot.turnDirection = 0;
    pilot.reverseUntil = 0;
  }

  return input;
}
