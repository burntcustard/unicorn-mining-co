import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { FlightMode, ThrusterCrescent } from '../../src/client/objects/modules';
import { Ship } from '../../src/client/objects/ship';
import { damage } from '../../src/client/objects/damage';
import { EntityState } from '../../src/client/simulation/entity-state';
import { cloneEntity } from '../../src/client/simulation/world-state';
import { createWorld, addEntity } from '../../src/client/simulation/world';
import * as Vec from '../../src/client/utilities/vector';
import { crescent } from '../../src/specs/ships/crescent';
import type { ShipSpec } from '../../src/specs/ships/types';

const near = (actual: number, expected: number, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

const position = (actual: Vec.Value, expected: Vec.Value) => {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
};

const makeShip = () => {
  const world = createWorld();

  return addEntity(world, createPlayerShip(world, { shipType: 'crescent' }));
};

const controller = (ship: Ship) =>
  ship.segments.find((segment) => segment.module instanceof FlightMode)!;
const hull = (ship: Ship, index: number) =>
  ship.segments.find((segment) => segment.module === ship.hullSegments[index])!;

const fold = (ship: Ship, progress = 1) => {
  ship.setModuleActive({ module: FlightMode, active: true });
  ship.updateModules(progress / controller(ship).rate);
};

{
  const ship = makeShip();
  const mount = ship.mounts[3];
  const mass = ship.mass;

  assert.equal(FlightMode.price, 0);
  assert.equal(FlightMode.mass, 0);
  assert.equal(FlightMode.health, 0);
  assert.equal(FlightMode.zIndex, undefined);
  assert.equal(controller(ship).module.mass, 0);
  assert.equal(controller(ship).module.health, 0);
  assert.equal(controller(ship).module.price, 0);
  assert.equal(damage(controller(ship), 100), 0);
  damage(mount.hull, 1);
  fold(ship);
  assert(ship.moduleActive({ module: FlightMode }));
  assert.equal(damage(controller(ship), 100), 0);
  near(controller(ship).activationProgress, 1);

  for (const oldHealth of [0, 25]) {
    const states = structuredClone(ship.moduleStates);

    states.find((state) => state.mount === 3)!.health = oldHealth;
    ship.moduleStates = states;
    assert.equal(damage(controller(ship), 100), 0);
    assert(ship.moduleActive({ module: FlightMode }));
  }

  ship.fit(0, mount);
  near(ship.mass, mass);
}

{
  const ship = makeShip();
  const points = ship.hullSegments.map((plan) => plan.points);
  const outlines = JSON.stringify(points);

  const before = ship.hitbox().map((collider) => ({
    segment: collider.segment!,
    position: Vec.clone(collider.localPosition!),
  }));

  const baseHullPosition = hull(ship, 1).localPosition;
  const baseMountPosition = ship.mounts[1].localPosition;
  const part = ship.segmentsAtMount(ship.mounts[1])[0];
  const partPosition = Vec.clone(part.localPosition);

  assert.equal(ship.mounts[3].module instanceof FlightMode, true);
  fold(ship, 0.5);
  near(controller(ship).activationProgress, 0.5);

  for (const index of [1, 3, 5, 7, 9]) {
    position(hull(ship, index).localPosition, Vec.create(-4, 5));
  }

  for (const index of [2, 4, 6, 8, 10]) {
    position(hull(ship, index).localPosition, Vec.create(-4, -5));
  }

  for (const index of [0, 11, 12, 13, 14]) {
    position(hull(ship, index).localPosition, Vec.create());
  }

  position(ship.mounts[1].localPosition, Vec.create(-48, -39));
  position(ship.mounts[2].localPosition, Vec.create(-48, 39));
  position(part.localPosition, Vec.add(partPosition, Vec.create(-4, 5)));
  position(baseHullPosition, Vec.create());
  position(baseMountPosition, Vec.create(-44, -44));
  assert.notEqual(hull(ship, 1).localPosition, baseHullPosition);
  assert.notEqual(ship.mounts[1].localPosition, baseMountPosition);

  ship.hitbox().forEach((collider, index) => {
    const source = before[index];
    const parent = source.segment.hull
      ? source.segment
      : source.segment.mount!.hull;
    const offset = parent.localPosition;

    position(collider.localPosition!, Vec.add(source.position, offset));
  });

  assert.equal(
    JSON.stringify(points),
    outlines,
    'authored outlines never move',
  );
  assert(
    ship.hullSegments.every((plan, index) => plan.points === points[index]),
  );

  ship.setModuleActive({ module: FlightMode, active: false });
  ship.updateModules(0.25 / controller(ship).rate);
  position(hull(ship, 1).localPosition, Vec.create(-2, 2.5));
  ship.updateModules(1 / controller(ship).rate);
  position(hull(ship, 1).localPosition, Vec.create());
  position(ship.mounts[1].localPosition, Vec.create(-44, -44));
}

{
  const ship = makeShip();

  fold(ship);
  const mount = ship.mounts[1];
  const replacement = new ThrusterCrescent();

  ship.fit(replacement, mount);
  position(mount.localPosition, Vec.create(-52, -34));
  position(ship.segmentsAtMount(mount)[0].localPosition, mount.localPosition);
  assert.equal(replacement.mount, mount);

  const rebuilt = hull(ship, 7);

  ship.segments = ship.segments.filter((segment) => segment !== rebuilt);
  ship.fixHull();
  position(hull(ship, 7).localPosition, Vec.create(-8, 10));

  const states = structuredClone(ship.moduleStates);
  const hydrated = makeShip();

  hydrated.moduleStates = states;
  position(hull(hydrated, 1).localPosition, Vec.create(-8, 10));
  position(hydrated.mounts[1].localPosition, Vec.create(-52, -34));
  position(
    hull(cloneEntity({ entity: hydrated }) as Ship, 1).localPosition,
    Vec.create(-8, 10),
  );

  const checkpoint = new EntityState(hydrated);

  hydrated.setModuleActive({ module: FlightMode, active: false });
  hydrated.updateModules(1 / controller(hydrated).rate);
  checkpoint.restore();
  position(hull(hydrated, 1).localPosition, Vec.create(-8, 10));
  position(hydrated.mounts[1].localPosition, Vec.create(-52, -34));

  hydrated.fit(0, hydrated.mounts[3]);
  position(hull(hydrated, 1).localPosition, Vec.create());
  position(hydrated.mounts[1].localPosition, Vec.create(-44, -44));
  near(hydrated.flightBoostFactor, 1);
}

{
  const ship = makeShip();
  const checkpoint = new EntityState(ship);

  fold(ship);
  checkpoint.restore();
  position(hull(ship, 1).localPosition, Vec.create());
  position(ship.mounts[1].localPosition, Vec.create(-44, -44));
  near(controller(ship).activationProgress, 0);

  fold(ship);
  ship.mounts[3].health = 0;
  ship.hitbox();
  position(hull(ship, 1).localPosition, Vec.create());
  near(ship.flightBoostFactor, 1);
}

{
  const combat = makeShip();
  const flight = makeShip();
  const forward = combat.forwardThrust;
  const turn = combat.rotationalThrust;
  const speed = combat.maxSpeed;

  fold(flight);
  near(flight.forwardThrust, forward * 1.3);
  near(flight.rotationalThrust, turn * 1.3);
  near(flight.maxSpeed, speed * 1.3);
  near(flight.rawForwardThrust, combat.rawForwardThrust);

  for (const ship of [combat, flight]) ship.fly(1, 0.5);
  combat.update(1 / 60);
  flight.update(1 / 60);
  near(Vec.length(flight.velocity), Vec.length(combat.velocity) * 1.3, 1e-5);
  near(flight.spin, combat.spin * 1.3, 1e-5);
  near(flight.fuel, combat.fuel, 1e-8);
}

{
  const ship = makeShip();

  fold(ship);
  const detached = hull(ship, 3);
  const expected = Vec.add(
    ship.position,
    Vec.add(detached.localPosition, Vec.create(...detached.middle!)),
  );
  const [fragment] = ship.fracture([detached], true, true);

  position(fragment.position, expected);
  const frozen = fragment.segments.map((segment) =>
    Vec.clone(segment.localPosition),
  );

  fragment.updateModules(2);
  fragment.segments.forEach((segment, index) =>
    position(segment.localPosition, frozen[index]),
  );
}

{
  const spec: ShipSpec = {
    ...crescent,
    initialLoadout: [],
    hullSegments: crescent.hullSegments.map((plan, index) =>
      index === 0
        ? {
            ...plan,
            mounts: [...plan.mounts!, [{ x: 0, y: 0, fits: ['flightMode'] }]],
          }
        : plan,
    ),
  };

  const ship = new Ship({ spec });

  ship.fit(new FlightMode(), ship.mounts[1]);
  ship.fit(new FlightMode(), ship.mounts[4]);
  const [first, second] = ship.segments.filter(
    (segment) => segment.module instanceof FlightMode,
  );

  first.module.flightBoost = 1.1;
  second.module.flightBoost = 1.4;
  first.activationProgress = 1;
  second.activationProgress = 0.5;
  ship.updateFlightMode();
  near(ship.flightBoostFactor, 1.2, 1e-8);
  position(hull(ship, 1).localPosition, Vec.create(-8, 10));
}
