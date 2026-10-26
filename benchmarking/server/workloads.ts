import assert from 'node:assert/strict';
import {
  approachControls,
  circleWaypoint,
  headingControls,
  neutralInput,
  stationSafeTarget,
  wrappedAngle,
} from '../utilities/ship-controls.ts';
import type { ProtocolCatalog } from '../utilities/protocol-runtime.ts';
import * as Vec from '../../src/client/utilities/vector.ts';
import type { PlayerInput } from '../../src/client/protocol/input.ts';
import type { ReplicatedEntity } from '../../src/client/protocol/network.ts';

export const playerCounts = [4, 8, 16, 32] as const;
export const workloadNames = [
  'convoy',
  'spread',
  'contact',
  'module',
  'weapon',
] as const;

export type ProtocolWorkload = (typeof workloadNames)[number];
export type ProtocolWeapon = 'none' | 'plasmaAccelerator' | 'autogun' | 'laser';

export const isOrdinaryAmmoItem = (
  item: NonNullable<ReplicatedEntity['cargoContents']>[number],
  catalog: Pick<ProtocolCatalog, 'ammoResource' | 'ammoRounds'>,
) =>
  'kind' in item &&
  item.kind === 'item' &&
  item.resource === catalog.ammoResource &&
  item.rounds === catalog.ammoRounds;

export const weaponForClient = (index: number): ProtocolWeapon =>
  (['none', 'plasmaAccelerator', 'autogun', 'laser'] as const)[index % 4];

export const weaponMeasurementLimit = ({
  rounds,
  fireInterval,
  reserveSeconds = 5,
}: {
  rounds: number;
  fireInterval: number;
  reserveSeconds?: number;
}) => (rounds * fireInterval) / 1000 - reserveSeconds;

export const weaponStagingControls = ({
  ship,
  index,
  players,
  entities,
}: {
  ship: ReplicatedEntity;
  index: number;
  players: number;
  entities: ReplicatedEntity[];
}) => {
  const angle = (index * Math.PI * 2) / players;
  const clear =
    !ship.dockedTo &&
    !ship.launching &&
    Math.abs(wrappedAngle(angle - ship.rotation)) < 0.25 &&
    weaponClearAhead({ ship, entities, distance: 500 }) &&
    entities.every(
      (entity) =>
        entity.kind !== 'station' ||
        Vec.distance(ship.position, entity.position) > entity.radius + 350,
    );

  return {
    clear,
    ready:
      clear &&
      Vec.length(ship.velocity || Vec.create()) < 20 &&
      Math.abs(ship.spin) < 0.2,
    input: clear
      ? headingControls({ ship, angle, thrust: false })
      : workloadControls({
          workload: 'weapon',
          index,
          players,
          elapsed: 0,
          ship,
          entities,
          fanout: true,
        }),
  };
};

export const obstacleRadius = (entity: ReplicatedEntity) => {
  const outlines =
    entity.segments
      ?.filter((segment) => segment.health > 0)
      .map((segment) => segment.shapeOutline) ||
    (entity.shapeOutline ? [entity.shapeOutline] : []);
  let radius = Math.max(entity.radius, entity.radiusEven || 0);

  for (const outline of outlines) {
    for (const point of outline) {
      radius = Math.max(radius, Math.hypot(point[0], point[1]));
    }
  }

  for (const segment of entity.wreckage || []) {
    if (segment.health < 1) continue;

    if (segment.shapeOutline?.length) {
      for (const [x, y] of segment.shapeOutline) {
        radius = Math.max(
          radius,
          Math.hypot(segment.offset.x + x, segment.offset.y + y),
        );
      }
    } else {
      radius = Math.max(radius, Vec.length(segment.offset) + segment.radius);
    }
  }

  return radius;
};

export const spreadLateralAllowance = 60;
export const spreadCorridorLength = 1800;

export type SpreadCorridor = {
  index: number;
  start: Vec.Value;
  heading: number;
  length: number;
  speed: number;
};

export type SpreadCorridorProposal = {
  index: number;
  position: Vec.Value;
  radius: number;
  candidates: SpreadCorridor[];
};

export const spreadCruiseSpeed = (seconds: number) => {
  assert(Number.isFinite(seconds) && seconds > 0, '--seconds must be positive');
  const speed = Math.min(50, (spreadCorridorLength - 100) / (seconds + 2) - 15);

  assert(
    seconds <= 35 && speed >= 30,
    'Spread needs a cruise threshold of at least 30 within its observed 1800-unit corridor, including a 15-unit/s thrust allowance and 100-unit reserve. Use --seconds 35 or less and increase --repetitions for a longer total capture.',
  );
  return speed;
};

export const spreadRemainingDistance = ({
  ship,
  corridor,
  seconds,
}: {
  ship: ReplicatedEntity;
  corridor: SpreadCorridor;
  seconds: number;
}) =>
  Math.max(corridor.speed + 15, Vec.length(ship.velocity || Vec.create())) *
    seconds +
  100;

const pointSegmentDistanceSquared = (
  point: Vec.Value,
  start: Vec.Value,
  end: Vec.Value,
) => {
  const delta = Vec.subtract(end, start);
  const lengthSquared = Vec.lengthSquared(delta);
  const along = lengthSquared
    ? Math.max(
        0,
        Math.min(1, Vec.dot(Vec.subtract(point, start), delta) / lengthSquared),
      )
    : 0;

  return Vec.distanceSquared(point, Vec.addScaled(start, delta, along));
};

export const spreadCorridorDeviation = ({
  position,
  corridor,
}: {
  position: Vec.Value;
  corridor: SpreadCorridor;
}) =>
  Math.sqrt(
    pointSegmentDistanceSquared(
      position,
      corridor.start,
      Vec.addScaled(
        corridor.start,
        Vec.create(Math.cos(corridor.heading), Math.sin(corridor.heading)),
        corridor.length,
      ),
    ),
  );

const segmentDistanceSquared = (
  start: Vec.Value,
  end: Vec.Value,
  otherStart: Vec.Value,
  otherEnd: Vec.Value,
) => {
  const delta = Vec.subtract(end, start);
  const otherDelta = Vec.subtract(otherEnd, otherStart);

  if (
    Vec.cross(delta, Vec.subtract(otherStart, start)) *
      Vec.cross(delta, Vec.subtract(otherEnd, start)) <
      0 &&
    Vec.cross(otherDelta, Vec.subtract(start, otherStart)) *
      Vec.cross(otherDelta, Vec.subtract(end, otherStart)) <
      0
  ) {
    return 0;
  }

  return Math.min(
    pointSegmentDistanceSquared(start, otherStart, otherEnd),
    pointSegmentDistanceSquared(end, otherStart, otherEnd),
    pointSegmentDistanceSquared(otherStart, start, end),
    pointSegmentDistanceSquared(otherEnd, start, end),
  );
};

/*
 * Check the complete observed corridor, including the reserved lateral drift.
 * This is current replicated geometry, not a guarantee about future NPC motion.
 */
export const spreadCorridorClear = ({
  ship,
  corridor,
  entities,
  stations,
  remaining,
}: {
  ship: ReplicatedEntity;
  corridor: SpreadCorridor;
  entities: ReplicatedEntity[];
  stations: ProtocolCatalog['stations'];
  remaining?: number;
}) => {
  const direction = Vec.create(
    Math.cos(corridor.heading),
    Math.sin(corridor.heading),
  );
  const distance =
    remaining ??
    Math.max(
      0,
      corridor.length -
        Vec.dot(Vec.subtract(ship.position, corridor.start), direction),
    );

  if (!Number.isFinite(distance) || distance < 0) return false;
  const end = Vec.addScaled(ship.position, direction, distance);

  if (
    [ship.position, end].some(
      (point) =>
        spreadCorridorDeviation({ position: point, corridor }) >
        spreadLateralAllowance,
    )
  ) {
    return false;
  }

  return entities.every((entity) => {
    if (
      entity.id === ship.id ||
      !['station', 'asteroid', 'ship', 'jumpGate', 'wormhole'].includes(
        entity.kind,
      )
    ) {
      return true;
    }

    const station =
      entity.kind === 'station' && stations[entity.definitionId || 'corral-5'];

    if (entity.kind === 'station' && !station) return false;

    // A station can carry a motionless pilot around its local movement frame.
    // Keep every allowed ship-center position outside that frame as well as
    // preserving the ordinary physical clearance.
    const clearance =
      Math.max(
        obstacleRadius(entity) + ship.radius + 80,
        station ? station.localMovementRadius : 0,
      ) + spreadLateralAllowance;

    const distanceSquared = pointSegmentDistanceSquared(
      entity.position,
      ship.position,
      end,
    );

    return station
      ? distanceSquared > clearance ** 2
      : distanceSquared >= clearance ** 2;
  });
};

export const proposeSpreadCorridors = ({
  ship,
  index,
  players,
  entities,
  stations,
  speed,
}: {
  ship: ReplicatedEntity;
  index: number;
  players: number;
  entities: ReplicatedEntity[];
  stations: ProtocolCatalog['stations'];
  speed: number;
}): SpreadCorridorProposal => {
  const radial = (index * Math.PI * 2) / players;
  const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];

  const candidates = offsets
    .map((offset) => ({
      index,
      start: Vec.clone(ship.position),
      heading: radial + (offset * Math.PI) / 12,
      length: spreadCorridorLength,
      speed,
    }))
    .filter((corridor) =>
      spreadCorridorClear({ ship, corridor, entities, stations }),
    );

  return {
    index,
    position: Vec.clone(ship.position),
    radius: ship.radius,
    candidates,
  };
};

export const reserveSpreadCorridors = ({
  proposals,
}: {
  proposals: SpreadCorridorProposal[];
}) => {
  const selected: { corridor: SpreadCorridor; radius: number }[] = [];

  for (const proposal of proposals.toSorted(
    (a, b) => a.candidates.length - b.candidates.length || a.index - b.index,
  )) {
    if (selected.some(({ corridor }) => corridor.index === proposal.index)) {
      continue;
    }

    const corridor = proposal.candidates.find((candidate) => {
      const end = Vec.addScaled(
        candidate.start,
        Vec.create(Math.cos(candidate.heading), Math.sin(candidate.heading)),
        candidate.length,
      );

      return selected.every((other) => {
        const otherEnd = Vec.addScaled(
          other.corridor.start,
          Vec.create(
            Math.cos(other.corridor.heading),
            Math.sin(other.corridor.heading),
          ),
          other.corridor.length,
        );

        return (
          segmentDistanceSquared(
            candidate.start,
            end,
            other.corridor.start,
            otherEnd,
          ) >=
          (proposal.radius + other.radius + 2 * spreadLateralAllowance + 100) **
            2
        );
      });
    });

    if (corridor) selected.push({ corridor, radius: proposal.radius });
  }

  return selected.map(({ corridor }) => corridor);
};

export const spreadCruiseControls = ({
  ship,
  corridor,
}: {
  ship: ReplicatedEntity;
  corridor: SpreadCorridor;
}) =>
  headingControls({
    ship,
    angle: corridor.heading,
    spinTolerance: 0.04,
    thrust: Vec.length(ship.velocity || Vec.create()) < corridor.speed,
  });

/*
 * A mining route may cross another rock before reaching its reserved target.
 * Take one ordinary circle hop around the first real hull on that route. The
 * assigned rock is excluded so its face remains physically approachable.
 */
export const obstacleSafeRoute = ({
  ship,
  target,
  entities,
  excludedId,
  avoidShips = false,
  asteroidMargin = 80,
  checkDetours = false,
  lookahead = Infinity,
  bounds,
}: {
  ship: ReplicatedEntity;
  target: Vec.Value;
  entities: ReplicatedEntity[];
  excludedId?: number;
  avoidShips?: boolean;
  asteroidMargin?: number;
  checkDetours?: boolean;
  lookahead?: number;
  bounds?: { position: Vec.Value; radius: number };
}) => {
  const withinBounds = (position: Vec.Value) =>
    !bounds ||
    Vec.distanceSquared(position, bounds.position) < bounds.radius ** 2;

  if (!withinBounds(target)) {
    return {
      target: Vec.clone(ship.position),
      routeChoice: 'blocked',
      blocked: true,
    };
  }

  const route = Vec.subtract(target, ship.position);
  const length = Vec.length(route);

  if (!length) return { target };
  const direction = Vec.scale(route, 1 / length);

  const circles: {
    entity: ReplicatedEntity;
    radius: number;
    margin: number;
    clearance: number;
  }[] = [];

  let first: (typeof circles)[number];

  let firstEntry = Infinity;

  for (const entity of entities) {
    if (
      (entity.kind !== 'station' &&
        entity.kind !== 'asteroid' &&
        !(avoidShips && entity.kind === 'ship')) ||
      entity.id === ship.id ||
      entity.id === excludedId
    ) {
      continue;
    }

    // Procedural polygon wander is inward. Explicit living outlines can be
    // bounded directly without reproducing any client or server geometry.
    const radius = obstacleRadius(entity);
    const margin = entity.kind === 'asteroid' ? asteroidMargin : 80;
    const clearance = radius + ship.radius + margin;
    const circle = { entity, radius, margin, clearance };

    circles.push(circle);
    const offset = Vec.subtract(entity.position, ship.position);
    const along = Vec.dot(offset, direction);
    const perpendicularSquared = Math.max(
      0,
      Vec.lengthSquared(offset) - along ** 2,
    );

    if (perpendicularSquared >= clearance ** 2) continue;
    const halfChord = Math.sqrt(clearance ** 2 - perpendicularSquared);
    const entry = Math.max(0, along - halfChord);

    // Distant blockers are reconsidered as the ship approaches. Detouring
    // around them now can trap an otherwise clear local approach.
    if (along + halfChord < 0 || entry > Math.min(length, lookahead)) {
      continue;
    }

    if (entry >= firstEntry) continue;

    first = circle;
    firstEntry = entry;
  }

  if (!first) return { target };

  const obstacle = {
    id: first.entity.id,
    kind: first.entity.kind,
    position: first.entity.position,
    radius: first.radius,
    clearanceMargin: first.margin,
    routeEntry: firstEntry,
  };

  const waypoint = (side = 1) =>
    circleWaypoint({
      ship,
      target,
      obstacle: first.entity,
      minimumRadius:
        first.radius + ship.radius + (checkDetours ? first.margin + 60 : 140),
      minimumStep: 0.15,
      side,
    });

  if (!checkDetours) {
    const destination = waypoint();

    return withinBounds(destination)
      ? { target: destination, obstacle }
      : {
          target: Vec.clone(ship.position),
          obstacle,
          routeChoice: 'blocked',
          blocked: true,
        };
  }

  const rejectionFor = (destination: Vec.Value) => {
    const step = Vec.subtract(destination, ship.position);
    const lengthSquared = Vec.lengthSquared(step);

    if (lengthSquared <= 16 ** 2) return () => false;

    return (circle: (typeof circles)[number]) => {
      const relative = Vec.subtract(ship.position, circle.entity.position);
      const startDistance = Vec.lengthSquared(relative);
      const finishDistance = Vec.distanceSquared(
        destination,
        circle.entity.position,
      );

      if (startDistance < circle.clearance ** 2) {
        // A ship already inside a safety margin may escape outward, but no
        // checked segment may carry it deeper into that existing overlap.
        return !(
          Vec.dot(relative, step) >= -1e-6 &&
          finishDistance > startDistance + 1e-6
        );
      }

      const along = Math.max(
        0,
        Math.min(1, -Vec.dot(relative, step) / lengthSquared),
      );

      return (
        Vec.lengthSquared(Vec.addScaled(relative, step, along)) <
        circle.clearance ** 2 - 1e-6
      );
    };
  };

  const clears = (destination: Vec.Value) =>
    withinBounds(destination) &&
    Vec.distanceSquared(destination, ship.position) > 16 ** 2 &&
    !circles.some(rejectionFor(destination));

  const initialOverlapIds = circles
    .filter(
      (circle) =>
        Vec.distanceSquared(ship.position, circle.entity.position) <
        circle.clearance ** 2,
    )
    .map((circle) => circle.entity.id);

  if (clears(target)) {
    return {
      target,
      obstacle,
      routeChoice: 'direct-outward-escape',
      initialOverlapIds,
    };
  }

  const relative = Vec.subtract(ship.position, first.entity.position);
  const away = Vec.lengthSquared(relative)
    ? Vec.normalize(relative)
    : Vec.create(1, 0);

  const canMirror =
    first.entity.kind !== 'ship' ||
    (Vec.length(first.entity.velocity || Vec.create()) < 5 &&
      !first.entity.thrust &&
      Math.abs(first.entity.spin ?? 0) < 0.2);

  const candidates = [
    {
      kind: 'preferred',
      position: waypoint(),
    },
    ...(canMirror ? [{ kind: 'mirrored', position: waypoint(-1) }] : []),
    {
      kind: 'radial-escape',
      position: Vec.addScaled(
        first.entity.position,
        away,
        Math.max(first.clearance + 60, Vec.length(relative) + 60),
      ),
    },
  ];

  const safe = candidates.find((candidate) => clears(candidate.position));

  return {
    target: safe?.position || Vec.clone(ship.position),
    obstacle,
    routeChoice: safe?.kind || 'blocked',
    initialOverlapIds,
    blocked: !safe,
  };
};

export const obstacleSafeTarget = (
  options: Parameters<typeof obstacleSafeRoute>[0],
) => obstacleSafeRoute(options).target;

/*
 * Keep the muzzle's near flight path clear before enabling normal fire. This
 * also prevents a close asteroid impact from splashing the firing ship.
 */
export const weaponClearAhead = ({
  ship,
  entities,
  distance = 200,
}: {
  ship: ReplicatedEntity;
  entities: ReplicatedEntity[];
  distance?: number;
}) => {
  const direction = Vec.create(
    Math.cos(ship.rotation),
    Math.sin(ship.rotation),
  );

  return entities.every((entity) => {
    if (
      entity.id === ship.id ||
      !['asteroid', 'station', 'ship'].includes(entity.kind)
    ) {
      return true;
    }

    const offset = Vec.subtract(entity.position, ship.position);
    const along = Math.max(0, Math.min(distance, Vec.dot(offset, direction)));
    const nearest = Vec.addScaled(ship.position, direction, along);

    return (
      Vec.distance(nearest, entity.position) > entity.radius + ship.radius + 40
    );
  });
};

export type MiningProposal = {
  index: number;
  position: Vec.Value;
  radius: number;
  wholeRocks: number;
  candidates: {
    asteroidId: number;
    asteroidRadius: number;
    anchor: Vec.Value;
    contact: Vec.Value;
    distance: number;
  }[];
};

export type MiningTarget = MiningProposal['candidates'][number] & {
  index: number;
  position: Vec.Value;
  shipRadius: number;
};

export const miningWorkingRadius = 900;
export const miningNavigationReserve = 250;

/*
 * Prefer larger real whole rocks with a clear straight approach, retaining
 * material through the measured drilling window. The
 * radius contact is only a reservation estimate; normal physical readiness
 * and measured damage must still establish actual drill contact.
 */
export const proposeMiningTargets = ({
  index,
  ship,
  entities,
}: {
  index: number;
  ship: ReplicatedEntity;
  entities: ReplicatedEntity[];
}): MiningProposal => {
  const whole = entities.filter(
    (entity) =>
      entity.kind === 'asteroid' &&
      entity.radius >= 120 &&
      (entity.health === undefined || entity.health > 0) &&
      !entity.decay &&
      !entity.shapeOutline &&
      !entity.segments,
  );

  return {
    index,
    position: Vec.clone(ship.position),
    radius: ship.radius,
    wholeRocks: whole.length,
    candidates: whole
      .flatMap((asteroid) => {
        if (
          entities.some(
            (entity) =>
              entity.kind === 'ship' &&
              entity.id !== ship.id &&
              Vec.distance(entity.position, asteroid.position) <
                entity.radius + asteroid.radius + 120,
          )
        ) {
          return [];
        }

        const route = obstacleSafeRoute({
          ship,
          target: asteroid.position,
          entities,
          excludedId: asteroid.id,
          avoidShips: true,
          asteroidMargin: 20,
          checkDetours: true,
        });

        if (route.target !== asteroid.position || route.blocked) return [];
        const contact = Vec.addScaled(
          asteroid.position,
          Vec.normalize(Vec.subtract(ship.position, asteroid.position)),
          asteroid.radius + ship.radius,
        );

        return [
          {
            asteroidId: asteroid.id,
            asteroidRadius: asteroid.radius,
            anchor: Vec.clone(asteroid.position),
            contact,
            distance: Vec.distance(ship.position, contact),
          },
        ];
      })
      .toSorted(
        (a, b) =>
          b.asteroidRadius - a.asteroidRadius ||
          a.distance - b.distance ||
          a.asteroidId - b.asteroidId,
      ),
  };
};

/*
 * Reserve unique real rocks and clear ship contact poses, starting with the
 * most constrained client. Earlier batches retain their actual reached poses.
 */
export const reserveMiningTargets = ({
  proposals,
  reserved = [],
}: {
  proposals: MiningProposal[];
  reserved?: MiningTarget[];
}) => {
  const targets = reserved.slice();

  const clearSegment = (
    from: Vec.Value,
    to: Vec.Value,
    position: Vec.Value,
    clearance: number,
  ) => {
    const step = Vec.subtract(to, from);
    const along = Math.max(
      0,
      Math.min(
        1,
        Vec.dot(Vec.subtract(position, from), step) /
          (Vec.lengthSquared(step) || 1),
      ),
    );

    return (
      Vec.distanceSquared(Vec.addScaled(from, step, along), position) >=
      clearance ** 2
    );
  };

  for (const proposal of proposals.toSorted(
    (a, b) => a.candidates.length - b.candidates.length || a.index - b.index,
  )) {
    if (targets.some((target) => target.index === proposal.index)) continue;

    const candidate = proposal.candidates.find((candidate) =>
      targets.every((target) => {
        const clearance = proposal.radius + target.shipRadius + 120;
        const route = Vec.subtract(candidate.contact, proposal.position);
        const otherRoute = Vec.subtract(target.contact, target.position);
        const crosses =
          Vec.cross(route, Vec.subtract(target.position, proposal.position)) *
            Vec.cross(route, Vec.subtract(target.contact, proposal.position)) <
            0 &&
          Vec.cross(
            otherRoute,
            Vec.subtract(proposal.position, target.position),
          ) *
            Vec.cross(
              otherRoute,
              Vec.subtract(candidate.contact, target.position),
            ) <
            0;

        return (
          !crosses &&
          candidate.asteroidId !== target.asteroidId &&
          Vec.distance(candidate.anchor, target.anchor) >=
            2 * miningWorkingRadius + clearance &&
          Vec.distance(candidate.contact, target.contact) >= clearance &&
          Vec.distance(candidate.anchor, target.contact) >=
            candidate.asteroidRadius + target.shipRadius + 120 &&
          Vec.distance(target.anchor, candidate.contact) >=
            target.asteroidRadius + proposal.radius + 120 &&
          clearSegment(
            proposal.position,
            candidate.contact,
            target.contact,
            clearance,
          ) &&
          clearSegment(
            target.position,
            target.contact,
            candidate.contact,
            clearance,
          )
        );
      }),
    );

    if (candidate) {
      targets.push({
        ...candidate,
        index: proposal.index,
        position: proposal.position,
        shipRadius: proposal.radius,
      });
    }
  }

  return targets;
};

/*
 * Moving fragments remain eligible inside their reserved working disk. The
 * reservation separates these disks from every other benchmark miner.
 */
export const miningAreaContains = ({
  position,
  anchor,
}: {
  position: Vec.Value;
  anchor: Vec.Value;
}) => Vec.distanceSquared(position, anchor) < miningWorkingRadius ** 2;

/*
 * A fractured rock's center may be empty. Aim just inside the nearest living
 * polygon face using only geometry supplied by normal snapshots. Untouched
 * procedural rocks do not send polygons and retain the center approach.
 */
export const miningAimPosition = ({
  asteroid,
  position,
}: {
  asteroid: ReplicatedEntity;
  position: Vec.Value;
}) => {
  const polygons =
    asteroid.segments
      ?.filter((segment) => segment.health > 0)
      .map((segment) => segment.shapeOutline) ||
    (asteroid.shapeOutline ? [asteroid.shapeOutline] : []);

  if (!polygons.length) return asteroid.position;
  const cosine = Math.cos(asteroid.rotation);
  const sine = Math.sin(asteroid.rotation);
  const relative = Vec.subtract(position, asteroid.position);
  const local = Vec.create(
    relative.x * cosine + relative.y * sine,
    -relative.x * sine + relative.y * cosine,
  );
  let nearest: Vec.Value;
  let inside: Vec.Value;
  let minimum = Infinity;

  for (const polygon of polygons) {
    const center = Vec.scale(
      polygon.reduce(
        (sum, point) => Vec.add(sum, Vec.create(point[0], point[1])),
        Vec.create(),
      ),
      1 / polygon.length,
    );

    for (let index = 0; index < polygon.length; index++) {
      const from = Vec.create(polygon[index][0], polygon[index][1]);
      const end = polygon[(index + 1) % polygon.length];
      const edge = Vec.subtract(Vec.create(end[0], end[1]), from);
      const along = Math.max(
        0,
        Math.min(
          1,
          Vec.dot(Vec.subtract(local, from), edge) /
            (Vec.lengthSquared(edge) || 1),
        ),
      );
      const point = Vec.addScaled(from, edge, along);
      const distance = Vec.distanceSquared(local, point);

      if (distance < minimum) {
        minimum = distance;
        nearest = point;
        inside = center;
      }
    }
  }

  if (!nearest) return asteroid.position;
  const inset = Vec.subtract(inside, nearest);
  const point = Vec.addScaled(
    nearest,
    Vec.normalize(inset),
    Math.min(6, Vec.length(inset) / 2),
  );

  return Vec.add(
    asteroid.position,
    Vec.create(
      point.x * cosine - point.y * sine,
      point.x * sine + point.y * cosine,
    ),
  );
};

/*
 * A living face is a drill-tip destination, not a ship-center destination.
 * Keep the complete transit check, ending at the fitted drill's center reach.
 * Opaque procedural rocks retain the conservative center route until their
 * normal snapshots expose a face.
 */
export const miningApproach = ({
  ship,
  asteroid,
  drillTip,
}: {
  ship: ReplicatedEntity;
  asteroid: ReplicatedEntity;
  drillTip?: { position: Vec.Value; radius: number };
}) => {
  const aim = miningAimPosition({ asteroid, position: ship.position });
  const reach = drillTip ? Vec.length(drillTip.position) : 0;
  const bearing = drillTip
    ? Math.atan2(drillTip.position.y, drillTip.position.x)
    : 0;
  const suppliedFace =
    asteroid.segments?.some(
      (segment) => segment.health > 0 && segment.shapeOutline.length > 2,
    ) ||
    (!asteroid.segments && asteroid.shapeOutline?.length > 2);

  return {
    aim,
    reach,
    bearing,
    target:
      suppliedFace && reach
        ? Vec.addScaled(
            aim,
            Vec.normalize(Vec.subtract(ship.position, aim)),
            reach,
          )
        : aim,
  };
};

/*
 * Reserve room for every living face and ordinary braking before following a
 * moving fragment. Its current fitted drill destination must fit as well.
 */
export const miningTargetContained = ({
  ship,
  asteroid,
  anchor,
  drillTip,
}: {
  ship: ReplicatedEntity;
  asteroid: ReplicatedEntity;
  anchor: Vec.Value;
  drillTip?: { position: Vec.Value; radius: number };
}) =>
  Vec.distance(asteroid.position, anchor) +
    obstacleRadius(asteroid) +
    ship.radius +
    miningNavigationReserve <
    miningWorkingRadius &&
  Vec.distance(miningApproach({ ship, asteroid, drillTip }).target, anchor) <
    miningWorkingRadius - miningNavigationReserve;

/*
 * Initially approach a close rock with the drill off. Once the group is ready,
 * keep it powered through local fragment turns inside the reserved area.
 * Transit, an empty area, or a nearby hull always disables it.
 */
export const miningDrillSafe = ({
  ship,
  asteroid,
  entities,
  workingArea,
}: {
  ship: ReplicatedEntity;
  asteroid?: ReplicatedEntity;
  entities: ReplicatedEntity[];
  workingArea?: Vec.Value;
}) => {
  if (!asteroid) return false;
  const offset = Vec.subtract(
    workingArea
      ? asteroid.position
      : miningAimPosition({ asteroid, position: ship.position }),
    ship.position,
  );

  const inArea =
    workingArea &&
    Vec.distance(ship.position, workingArea) < miningWorkingRadius &&
    miningAreaContains({
      position: asteroid.position,
      anchor: workingArea,
    });

  if (
    workingArea
      ? !inArea
      : Vec.distance(asteroid.position, ship.position) >
          ship.radius + asteroid.radius + 35 ||
        Math.abs(wrappedAngle(Math.atan2(offset.y, offset.x) - ship.rotation)) >
          0.35
  ) {
    return false;
  }

  return entities.every(
    (entity) =>
      entity.id === ship.id ||
      entity.kind !== 'ship' ||
      Vec.distance(entity.position, ship.position) >
        ship.radius + entity.radius + 100,
  );
};

export const workloadControls = ({
  workload,
  index,
  players,
  elapsed,
  ship,
  entities,
  partner,
  asteroidPositions = [],
  miningAnchor,
  miningAsteroid,
  drillTip,
  mining = true,
  firing = true,
  fanout = false,
  spreadCorridor,
}: {
  workload: ProtocolWorkload;
  index: number;
  players: number;
  elapsed: number;
  ship: ReplicatedEntity;
  entities: ReplicatedEntity[];
  partner?: ReplicatedEntity;
  asteroidPositions?: Vec.Value[];
  miningAnchor?: Vec.Value;
  miningAsteroid?: ReplicatedEntity;
  drillTip?: { position: Vec.Value; radius: number };
  mining?: boolean;
  firing?: boolean;
  fanout?: boolean;
  spreadCorridor?: SpreadCorridor;
}): PlayerInput => {
  if (!fanout && workload === 'spread') {
    return spreadCorridor
      ? spreadCruiseControls({ ship, corridor: spreadCorridor })
      : neutralInput();
  }

  const heading = (index * Math.PI * 2) / players;

  if (fanout || workload === 'weapon') {
    const stations = entities.filter((entity) => entity.kind === 'station');
    const destination = Vec.addScaled(
      ship.position,
      Vec.create(Math.cos(heading), Math.sin(heading)),
      4000,
    );

    const outwardRoute =
      fanout && workload === 'module'
        ? obstacleSafeRoute({
            ship,
            target: stationSafeTarget({
              ship,
              target: destination,
              entities,
            }),
            entities: entities.filter(
              (entity) => entity.kind === 'station' || entity.kind === 'ship',
            ),
            avoidShips: true,
            checkDetours: true,
            lookahead: 500,
          })
        : undefined;

    const target =
      outwardRoute?.target ??
      (fanout && workload === 'weapon'
        ? obstacleSafeTarget({ ship, target: destination, entities })
        : stationSafeTarget({ ship, target: destination, entities }));

    const input = outwardRoute?.blocked
      ? neutralInput()
      : fanout && workload === 'module'
        ? headingControls({
            ship,
            angle: Math.atan2(
              target.y - ship.position.y,
              target.x - ship.position.x,
            ),
            thrust: Vec.length(ship.velocity || Vec.create()) < 100,
          })
        : !fanout && workload === 'weapon'
          ? firing
            ? headingControls({ ship, angle: heading, thrust: false })
            : weaponStagingControls({ ship, index, players, entities }).input
          : target !== destination || (fanout && workload === 'spread')
            ? approachControls({
                ship,
                target,
                maxSpeed: workload === 'spread' ? 100 : 220,
              })
            : headingControls({
                ship,
                angle: heading,
                thrust: fanout || workload !== 'weapon',
              });

    if (!fanout && workload === 'weapon') {
      const weapon = weaponForClient(index);
      const clear =
        !ship.dockedTo &&
        !ship.launching &&
        Math.abs(wrappedAngle(heading - ship.rotation)) < 0.25 &&
        weaponClearAhead({ ship, entities }) &&
        stations.every(
          (station) =>
            Vec.distance(ship.position, station.position) >
            station.radius + 350,
        );

      input.fire = firing && weapon !== 'none' && clear;
      input.plasmaActive = weapon === 'plasmaAccelerator';
      input.autogunActive = weapon === 'autogun';
      input.laserActive = weapon === 'laser';
    }

    return input;
  }

  if (workload === 'convoy') {
    const destination = Vec.addScaled(
      ship.position,
      Vec.create(Math.cos(0.25), Math.sin(0.25)),
      4000,
    );
    const target = stationSafeTarget({ ship, target: destination, entities });
    const input =
      target === destination
        ? headingControls({ ship, angle: 0.25 })
        : approachControls({ ship, target, maxSpeed: 220 });

    if (elapsed % 8 >= 6) input.thrust = 0;
    return input;
  }

  if (workload === 'contact') {
    // Paired clients share a worker and remain a single physical workload group.
    return partner
      ? approachControls({
          ship,
          target: stationSafeTarget({
            ship,
            target: partner.position,
            entities,
          }),
          maxSpeed: 60,
        })
      : headingControls({ ship, angle: heading + Math.PI });
  }

  const approach =
    miningAsteroid &&
    miningApproach({ ship, asteroid: miningAsteroid, drillTip });
  const recovering =
    mining &&
    miningAnchor &&
    Vec.distance(ship.position, miningAnchor) >
      miningWorkingRadius - miningNavigationReserve;
  const targetPosition = recovering
    ? miningAnchor
    : approach?.aim || miningAnchor || asteroidPositions[0];
  const destination = recovering
    ? miningAnchor
    : approach?.target || targetPosition;
  const distance = targetPosition
    ? Vec.distance(ship.position, targetPosition)
    : Infinity;

  const route =
    destination &&
    obstacleSafeRoute({
      ship,
      target: destination,
      entities,
      excludedId: recovering ? undefined : miningAsteroid?.id,
      avoidShips: true,
      asteroidMargin: 20,
      checkDetours: true,
      lookahead: 500,
      bounds:
        mining && miningAnchor
          ? {
              position: miningAnchor,
              radius: miningWorkingRadius - miningNavigationReserve,
            }
          : undefined,
    });

  const routeTarget = route?.target;

  const detour = routeTarget !== destination;

  const input = route?.blocked
    ? neutralInput()
    : !recovering &&
        miningAsteroid &&
        !detour &&
        distance < miningAsteroid.radius + ship.radius + 80
      ? headingControls({
          ship,
          angle:
            Math.atan2(
              targetPosition.y - ship.position.y,
              targetPosition.x - ship.position.x,
            ) - (approach?.bearing || 0),
          thrust:
            distance > (approach?.reach || 0) &&
            Vec.dot(
              Vec.subtract(
                ship.velocity || Vec.create(),
                miningAsteroid.velocity || Vec.create(),
              ),
              Vec.normalize(Vec.subtract(targetPosition, ship.position)),
            ) < 25,
        })
      : targetPosition
        ? approachControls({
            ship,
            target: routeTarget,
            velocity:
              recovering || detour ? undefined : miningAsteroid?.velocity,
            maxSpeed:
              distance < (miningAsteroid?.radius ?? 100) + 200 ? 35 : 100,
          })
        : headingControls({ ship, angle: heading });

  input.hornDrill =
    mining &&
    (!miningAnchor ||
      (!!miningAsteroid &&
        miningTargetContained({
          ship,
          asteroid: miningAsteroid,
          anchor: miningAnchor,
          drillTip,
        }))) &&
    miningDrillSafe({
      ship,
      asteroid: miningAsteroid,
      entities,
      workingArea: miningAnchor,
    });

  input.cargoHatch = true;
  input.searchLight = true;
  return input;
};
