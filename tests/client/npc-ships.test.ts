import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { createWorld, addEntity } from '../../src/client/simulation/world';
import { damage } from '../../src/client/objects/damage';
import { traceLaser } from '../../src/client/objects/modules/trace-laser';
import { controlShip } from '../../src/client/objects/control-ship';
import { emptyPlayerInput } from '../../src/client/protocol/input';
import * as Vec from '../../src/client/utilities/vector';

for (const side of [1, 2]) {
  const world = createWorld();
  const ship = addEntity(
    world,
    createPlayerShip(world, { shipType: 'crescent' }),
  );
  const hull = ship.segments.find(
    (segment) => segment.module === ship.hullSegments[side],
  )!;

  damage(hull, 10000);
  ship.update(0);
  assert(ship.dead, 'either crescent side is essential');
}

for (const [shipType, index] of [
  ['crescent', 3],
  ['crescent', 4],
  ['crescent', 5],
  ['crescent', 6],
] as const) {
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { shipType }));
  const observer = createPlayerShip(world);
  const insert = ship.segments.find(
    (segment) => segment.module === ship.hullSegments[index],
  )!;
  const outline = insert.points as number[][];
  const center = Vec.create(
    outline.reduce((sum, point) => sum + point[0], 0) / outline.length,
    outline.reduce((sum, point) => sum + point[1], 0) / outline.length,
  );

  const ray = {
    craft: observer,
    start: center,
    end: Vec.add(center, Vec.create(0.1, 0)),
  };

  assert.equal(
    traceLaser(ray).first?.segment,
    insert,
    'yellow pieces occupy cutouts without underlying wing collisions',
  );

  const area = outline.reduce((sum, a, index) => {
    const b = outline[(index + 1) % outline.length];

    return sum + a[0] * b[1] - a[1] * b[0];
  }, 0);

  outline.forEach((a, index) => {
    const b = outline[(index + 1) % outline.length];
    const outward = Vec.normalize(Vec.create(b[1] - a[1], a[0] - b[0]));
    const at = Vec.add(
      Vec.create((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
      Vec.scale(outward, area < 0 ? -1 : 1),
    );

    assert(
      !traceLaser({
        craft: observer,
        start: at,
        end: Vec.add(at, Vec.create(0.1, 0)),
      }).first,
      'sockets leave room around each insert for its outline',
    );
  });

  damage(insert, 10000);
  assert(
    !traceLaser(ray).first,
    'removing a yellow piece leaves an open notch in the wing',
  );
}

for (const index of [5, 6, 7, 8, 9, 10]) {
  const world = createWorld();
  const ship = addEntity(
    world,
    createPlayerShip(world, { shipType: 'crescent' }),
  );
  const part = ship.segments.find(
    (segment) => segment.module === ship.hullSegments[index],
  )!;
  const engines = ship.engines.length;
  const carriesEngine = part.mounts?.some(
    (mount) => mount.module && mount.module.forwardThrust,
  );

  damage(part, 10000);
  ship.update(0);
  assert(
    !ship.dead,
    'losing a colored side section leaves the main crescent structure intact',
  );
  assert(
    !ship.segments.includes(part),
    'the destroyed section detaches independently',
  );
  assert.equal(
    ship.engines.length,
    engines - Number(!!carriesEngine),
    'a destroyed engine section loses only its own thruster',
  );
}

{
  const world = createWorld();
  const ship = addEntity(
    world,
    createPlayerShip(world, { shipType: 'crescent' }),
  );
  const observer = createPlayerShip(world);

  const trace = traceLaser({
    craft: observer,
    start: Vec.create(20, -10),
    end: Vec.create(30, -10),
  });

  assert(
    !trace.first,
    'the crescent does not fill the empty interior of its curved side',
  );
  const health = ship.segments.find(
    (segment) => segment.module === ship.hullSegments[1],
  )!.health;
  const collider = ship
    .hitbox()
    .find((collider) => collider.segment?.module === ship.hullSegments[1])!;

  damage(collider.segment!, 5);
  assert.equal(
    collider.segment!.health,
    health - 5,
    'convex pieces share the original segment health',
  );
}

{
  const ship = createPlayerShip(createWorld(), {
    shipType: 'crescent',
    playerId: 1,
  });

  controlShip(ship, { ...emptyPlayerInput(), thrust: 1, fire: true }, []);
  assert.equal(ship.forward, 1, 'owned ships accept normal player controls');
  assert(ship.firing);
  assert.deepEqual(
    ship.applyDockAction({ action: 'paint', paint: 0 }, { credits: 1000 }),
    { action: 'paint', paint: 0 },
    'owned ships accept normal customization independently of station offers',
  );
}
