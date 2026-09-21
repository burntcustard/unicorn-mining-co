import { type ShipEntity, type StationEntity } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { type Contact } from '../../types';
import { Vector } from '../../vector';

type Dockable = Contact['collider'] & {
  docked?: (station: Dockable) => void;
  dockedTo?: Dockable | 0;
  launching?: number;
  sections?: unknown[];
  started?: number;
};

const bayHalfWidth = 140;
const bayStart = 150;
const dockSegment = Array.from({ length: 5 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 5;
  return [
    138 * Math.cos(angle) + 100 * Math.sin(angle),
    138 * Math.sin(angle) - 100 * Math.cos(angle),
  ];
});

const localPosition = (ship: ShipEntity, station: StationEntity) => {
  const offset = ship.position.subtract(station.position);
  const cosine = Math.cos(station.rotation);
  const sine = Math.sin(station.rotation);

  return Vector(
    offset.x * cosine + offset.y * sine,
    offset.y * cosine - offset.x * sine,
  );
};

const overlapsDockSegment = (ship: ShipEntity, station: StationEntity) => {
  const center = localPosition(ship, station);
  const axes = dockSegment.map(([x, y], i) => {
    const [nextX, nextY] = dockSegment[(i + 1) % dockSegment.length];
    return Vector(nextY - y, x - nextX).normalize();
  });
  const nearest = dockSegment.reduce((best, point) =>
    Vector(point[0], point[1]).subtract(center).length() <
    Vector(best[0], best[1]).subtract(center).length()
      ? point
      : best,
  );

  axes.push(Vector(nearest[0], nearest[1]).subtract(center).normalize());
  return axes.every((axis) => {
    const polygon = dockSegment.map(([x, y]) => x * axis.x + y * axis.y);
    const near = Math.min(...polygon);
    const far = Math.max(...polygon);
    const point = center.dot(axis);

    return point + ship.radius > near && point - ship.radius < far;
  });
};

export const inDockingBay = (ship: ShipEntity, station: StationEntity) => {
  const position = localPosition(ship, station);

  return position.x > bayStart && Math.abs(position.y) < bayHalfWidth;
};

/** Place a browser-game craft inside a station's bay. */
export const dockAt = (ship: Dockable, station: Dockable) => {
  ship.position.set(station.position);
  Object.assign(ship, {
    dockedTo: station,
    rotation: station.rotation,
  });
};

/** Latch browser-game craft touching docking segments. */
export const dock = (contacts: Contact[]) => {
  contacts.forEach(({ collider, other }) => {
    const home = collider.dockSegment ? collider : other;
    const ship = (home === collider ? other : collider).owner as Dockable;
    const station = home.owner as Dockable;

    if (!home.dockSegment || !ship || ship.launching || ship.sections) return;

    dockAt(ship, station);
    ship.docked?.(station);
  });
};

/** Set a docked browser-game craft off out through the bay. */
export const launch = (craft: Dockable) => {
  craft.dockedTo = 0;
  craft.launching = 3;
  craft.started = 1;
  craft.launchRequested = 1;
};

/** Advance a browser-game craft's automatic launch. */
export const flyOut = (craft: Dockable, dt: number) => {
  if (!craft.launching) return;

  craft.launching = Math.max(0, craft.launching - dt);
  return 1;
};

export const tryDock = (
  ship: ShipEntity,
  station: StationEntity,
  events: SimulationEvent[],
) => {
  if (
    ship.dockedTo !== undefined ||
    ship.launching ||
    !overlapsDockSegment(ship, station)
  )
    return false;

  ship.dockedTo = station.id;
  ship.position.set(station.position);
  ship.rotation = station.rotation;
  ship.velocity.x = ship.velocity.y = ship.spin = 0;
  if (ship.playerId !== undefined)
    events.push({
      playerId: ship.playerId,
      stationId: station.id,
      type: 'docked',
    });
  return true;
};
