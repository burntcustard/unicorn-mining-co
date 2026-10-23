import * as Vec from '../../src/client/utilities/vector.ts';
import type { PlayerInput } from '../../src/client/protocol/input.ts';
import type { ReplicatedEntity } from '../../src/client/protocol/network.ts';

export const neutralInput = (): PlayerInput => ({
  hornDrill: false,
  cargoHatch: false,
  searchLight: false,
  launch: false,
  shieldGenerator: false,
  thrust: 0,
  turn: 0,
});

export const compatibleWeaponMount = ({
  mounts,
  weapon,
  occupied,
}: {
  mounts: string[][];
  weapon: string;
  occupied: number[];
}) => {
  const compatible = mounts.flatMap((fits, index) =>
    fits.includes(weapon) ? [index] : [],
  );

  return compatible.find((mount) => !occupied.includes(mount)) ?? compatible[0];
};

export const wrappedAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

export const headingControls = ({
  ship,
  angle,
  thrust = true,
  spinTolerance = 0.16,
}: {
  ship: ReplicatedEntity;
  angle: number;
  thrust?: boolean;
  spinTolerance?: number;
}): PlayerInput => {
  const error = wrappedAngle(angle - ship.rotation);
  // Brake angular motion before reaching the desired heading. Wire controls are
  // ordinary keyboard values rather than the NPC's analog steering inputs.
  const desiredSpin = Math.max(-2.2, Math.min(2.2, error * 3));
  const turn =
    Math.abs(desiredSpin - ship.spin) < spinTolerance
      ? 0
      : Math.sign(desiredSpin - ship.spin);

  return {
    ...neutralInput(),
    turn,
    thrust: Number(thrust && Math.abs(error) < 0.35),
  };
};

export const approachControls = ({
  ship,
  target,
  velocity = Vec.create(),
  maxSpeed = 160,
}: {
  ship: ReplicatedEntity;
  target: Vec.Value;
  velocity?: Vec.Value;
  maxSpeed?: number;
}) => {
  const offset = Vec.subtract(target, ship.position);
  const desired = Vec.add(
    velocity,
    Vec.scale(
      Vec.normalize(offset),
      Math.min(maxSpeed, Vec.length(offset) * 0.75),
    ),
  );
  const correction = Vec.subtract(desired, ship.velocity || Vec.create());

  const input = headingControls({
    ship,
    angle: Math.atan2(correction.y, correction.x),
    thrust: Vec.length(correction) > 12,
  });

  return input;
};

/*
 * Approach a real station bay from outside its hull, then enter its physical
 * docking trigger. The station pose and bay angles come from normal snapshots.
 */
export const dockingControls = ({
  ship,
  station,
  bayAngles,
  entering = false,
}: {
  ship: ReplicatedEntity;
  station: ReplicatedEntity;
  bayAngles: number[];
  entering?: boolean;
}) => {
  const relative = Vec.subtract(ship.position, station.position);
  const angle = Math.atan2(relative.y, relative.x);
  const bayAngle = bayAngles
    .map((bay) => bay + station.rotation)
    .toSorted(
      (a, b) =>
        Math.abs(wrappedAngle(a - angle)) - Math.abs(wrappedAngle(b - angle)),
    )[0];
  const direction = Vec.create(Math.cos(bayAngle), Math.sin(bayAngle));
  const along = Vec.dot(relative, direction);
  const across = Math.abs(Vec.cross(relative, direction));
  const radius = station.radius;

  if (across > 65 || along < 0 || Vec.length(relative) > radius + 320) {
    entering = false;
  }

  if (across < 25 && along > radius && along < radius + 210) entering = true;
  const delta = wrappedAngle(bayAngle - angle);
  let target: Vec.Value;

  if (entering) {
    target = station.position;
  } else if (Math.abs(delta) > 0.3) {
    const next = angle + Math.sign(delta) * Math.min(0.4, Math.abs(delta));

    target = Vec.addScaled(
      station.position,
      Vec.create(Math.cos(next), Math.sin(next)),
      Math.max(radius + 170, Vec.length(relative)),
    );
  } else {
    target = Vec.addScaled(station.position, direction, radius + 130);
  }

  const input = approachControls({
    ship,
    target,
    velocity: station.velocity,
    maxSpeed: entering ? 85 : 140,
  });

  return { input, entering, target };
};

export const circleWaypoint = ({
  ship,
  target,
  obstacle,
  minimumRadius,
  minimumStep = 0,
  side = 1,
}: {
  ship: ReplicatedEntity;
  target: Vec.Value;
  obstacle: ReplicatedEntity;
  minimumRadius: number;
  minimumStep?: number;
  side?: number;
}) => {
  const relative = Vec.subtract(ship.position, obstacle.position);
  const angle = Math.atan2(relative.y, relative.x);
  const destination = Vec.subtract(target, obstacle.position);
  const delta = wrappedAngle(Math.atan2(destination.y, destination.x) - angle);
  // Opposing moving hulls both pass to their own right. Choosing the shortest
  // side independently can send both pilots toward the same world position.
  const step =
    obstacle.kind === 'ship'
      ? -0.35
      : side *
        Math.sign(delta || 1) *
        Math.min(0.35, Math.max(minimumStep, Math.abs(delta)));
  const next = angle + step;

  return Vec.addScaled(
    obstacle.position,
    Vec.create(Math.cos(next), Math.sin(next)),
    Math.max(minimumRadius, Vec.length(relative)),
  );
};

/*
 * Keep ordinary flight paths outside station hulls until they reach the bay's
 * exterior. This is navigation through snapshots, not an altered spawn pose.
 */
export const stationSafeTarget = ({
  ship,
  target,
  entities,
}: {
  ship: ReplicatedEntity;
  target: Vec.Value;
  entities: ReplicatedEntity[];
}) => {
  for (const station of entities.filter(
    (entity) => entity.kind === 'station',
  )) {
    const route = Vec.subtract(target, ship.position);
    const lengthSquared = Vec.lengthSquared(route);
    const projection = lengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            Vec.dot(Vec.subtract(station.position, ship.position), route) /
              lengthSquared,
          ),
        )
      : 0;
    const nearest = Vec.addScaled(ship.position, route, projection);

    if (
      Vec.distance(nearest, station.position) >=
      station.radius + ship.radius + 80
    ) {
      continue;
    }

    return circleWaypoint({
      ship,
      target,
      obstacle: station,
      minimumRadius: station.radius + 220,
    });
  }

  return target;
};
