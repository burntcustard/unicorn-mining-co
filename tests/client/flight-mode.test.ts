import assert from 'node:assert/strict';
import {
  FlightMode,
  PowerPlant2E,
  ThrusterSingleSm,
} from '../../src/client/objects/modules';
import { Ship } from '../../src/client/objects/ship';
import { damage } from '../../src/client/objects/damage';
import { EntityState } from '../../src/client/simulation/entity-state';
import { cloneEntity } from '../../src/client/simulation/world-state';
import { createWorld, addEntity } from '../../src/client/simulation/world';
import * as Vec from '../../src/client/utilities/vector';
import { boosterShipSpec } from '../support/booster-ship';
import { installExampleModules } from '../support/example-modules';
import { flightMode } from '../../src/specs/modules/utility/flight-mode';
import type { ShipSpec } from '../../src/specs/ships/types';

const near = (actual: number, expected: number, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

const position = (actual: Vec.Value, expected: Vec.Value) => {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
};

installExampleModules();

const controllerSpec = {
  ...flightMode,
  activationDuration: 0.4,
  flightBoost: 1.25,
};

Object.assign(FlightMode, controllerSpec, {
  model: FlightMode.createModel(controllerSpec),
});

const controllerMount = 0;
const spareMount = 2;
const engineMount = 3;

const spec: ShipSpec = {
  ...boosterShipSpec,
  hullSegments: [
    {
      core: true,
      health: 100,
      points: [
        [-10, -6],
        [10, -6],
        [10, 6],
        [-10, 6],
      ],
      mounts: [
        [{ x: 0, y: 0, fits: ['flightMode'] }],
        [{ x: 2, y: 0, fits: ['powerPlant2E'] }],
        [{ x: -2, y: 0, fits: ['flightMode'] }],
      ],
    },
    {
      core: true,
      essential: true,
      health: 100,
      points: [
        [-10, 6],
        [10, 6],
        [10, 14],
        [-10, 14],
      ],
      flightOffset: [-4, -2],
      mounts: [[{ x: -6, y: 11, fits: ['thrusterSingleSm'] }]],
    },
    {
      health: 100,
      points: [
        [-10, 14],
        [10, 14],
        [10, 22],
        [-10, 22],
      ],
      connections: [1],
    },
  ],
};

const makeShip = () => {
  const world = createWorld();
  const ship = addEntity(world, new Ship({ world, spec }));

  ship.fit(new FlightMode(), ship.mounts[controllerMount]);
  ship.fit(new PowerPlant2E());
  ship.fit(new ThrusterSingleSm(), ship.mounts[engineMount]);
  ship.storedPower = ship.powerCapacity;
  return ship;
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
  const mount = ship.mounts[controllerMount];
  const mass = ship.mass;

  assert.equal(damage(controller(ship), 100), 0);
  damage(mount.hull, 1);
  fold(ship);
  assert(ship.moduleActive({ module: FlightMode }));
  assert.equal(damage(controller(ship), 100), 0);
  near(controller(ship).activationProgress, 1);

  {
    const oldHealth = 0;
    const states = structuredClone(ship.moduleStates);

    states.find((state) => state.mount === controllerMount)!.health = oldHealth;
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
  const baseMountPosition = ship.mounts[engineMount].localPosition;
  const part = ship.segmentsAtMount(ship.mounts[engineMount])[0];
  const partPosition = Vec.clone(part.localPosition);

  assert.equal(ship.mounts[controllerMount].module instanceof FlightMode, true);
  fold(ship, 0.5);
  near(controller(ship).activationProgress, 0.5);

  position(hull(ship, 0).localPosition, Vec.create());
  position(hull(ship, 1).localPosition, Vec.create(-2, -1));
  position(hull(ship, 2).localPosition, Vec.create(-2, -1));
  position(ship.mounts[engineMount].localPosition, Vec.create(-8, 10));
  position(part.localPosition, Vec.add(partPosition, Vec.create(-2, -1)));
  position(baseHullPosition, Vec.create());
  position(baseMountPosition, Vec.create(-6, 11));
  assert.notEqual(hull(ship, 1).localPosition, baseHullPosition);
  assert.notEqual(ship.mounts[engineMount].localPosition, baseMountPosition);

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
  position(hull(ship, 1).localPosition, Vec.create(-1, -0.5));
  ship.updateModules(1 / controller(ship).rate);
  position(hull(ship, 1).localPosition, Vec.create());
  position(ship.mounts[engineMount].localPosition, Vec.create(-6, 11));
}

{
  const ship = makeShip();

  fold(ship);
  const mount = ship.mounts[engineMount];
  const replacement = new ThrusterSingleSm();

  ship.fit(replacement, mount);
  position(mount.localPosition, Vec.create(-10, 9));
  position(ship.segmentsAtMount(mount)[0].localPosition, mount.localPosition);
  assert.equal(replacement.mount, mount);

  const rebuilt = hull(ship, 2);

  ship.segments = ship.segments.filter((segment) => segment !== rebuilt);
  ship.fixHull();
  position(hull(ship, 2).localPosition, Vec.create(-4, -2));

  const states = structuredClone(ship.moduleStates);
  const hydrated = makeShip();

  hydrated.moduleStates = states;
  position(hull(hydrated, 1).localPosition, Vec.create(-4, -2));
  position(hydrated.mounts[engineMount].localPosition, Vec.create(-10, 9));
  position(
    hull(cloneEntity({ entity: hydrated }) as Ship, 1).localPosition,
    Vec.create(-4, -2),
  );

  const checkpoint = new EntityState(hydrated);

  hydrated.setModuleActive({ module: FlightMode, active: false });
  hydrated.updateModules(1 / controller(hydrated).rate);
  checkpoint.restore();
  position(hull(hydrated, 1).localPosition, Vec.create(-4, -2));
  position(hydrated.mounts[engineMount].localPosition, Vec.create(-10, 9));

  hydrated.fit(0, hydrated.mounts[controllerMount]);
  position(hull(hydrated, 1).localPosition, Vec.create());
  position(hydrated.mounts[engineMount].localPosition, Vec.create(-6, 11));
  near(hydrated.flightBoostFactor, 1);
}

{
  const ship = makeShip();
  const checkpoint = new EntityState(ship);

  fold(ship);
  checkpoint.restore();
  position(hull(ship, 1).localPosition, Vec.create());
  position(ship.mounts[engineMount].localPosition, Vec.create(-6, 11));
  near(controller(ship).activationProgress, 0);

  fold(ship);
  ship.mounts[controllerMount].health = 0;
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
  near(flight.forwardThrust, forward * 1.25);
  near(flight.rotationalThrust, turn * 1.25);
  near(flight.maxSpeed, speed * 1.25);
  near(flight.rawForwardThrust, combat.rawForwardThrust);

  for (const ship of [combat, flight]) ship.fly(1, 0.5);
  combat.update(1 / 60);
  flight.update(1 / 60);
  near(Vec.length(flight.velocity), Vec.length(combat.velocity) * 1.25, 1e-5);
  near(flight.spin, combat.spin * 1.25, 1e-5);
  near(flight.fuel, combat.fuel, 1e-8);
}

{
  const ship = makeShip();

  fold(ship);
  const detached = hull(ship, 2);
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
  const ship = makeShip();

  ship.fit(new FlightMode(), ship.mounts[spareMount]);
  const [first, second] = ship.segments.filter(
    (segment) => segment.module instanceof FlightMode,
  );

  first.module.flightBoost = 1.1;
  second.module.flightBoost = 1.4;
  first.activationProgress = 1;
  second.activationProgress = 0.5;
  ship.updateFlightMode();
  near(ship.flightBoostFactor, 1.2, 1e-8);
  position(hull(ship, 1).localPosition, Vec.create(-4, -2));
}

{
  const ship = makeShip();

  damage(hull(ship, 1), 100);
  ship.update(0);
  assert(
    ship.dead,
    'losing an essential hull destroys a ship with a surviving core',
  );
}
