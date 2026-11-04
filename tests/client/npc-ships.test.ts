import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import { createWorld, addEntity } from '../../src/client/simulation/world';
import { damage } from '../../src/client/objects/damage';
import { Craft } from '../../src/client/objects/craft';
import { crystalBeams } from '../../src/client/objects/crystal-beams';
import { traceLaser } from '../../src/client/objects/modules/trace-laser';
import { Item } from '../../src/client/objects/item';
import { gold } from '../../src/specs/items';
import { colors } from '../../src/specs/colors';
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

{
  const world = createWorld();
  const ship = addEntity(
    world,
    createPlayerShip(world, { shipType: 'crystal' }),
  );
  const side = ship.segments.find(
    (segment) => segment.module === ship.hullSegments[4],
  )!;

  damage(side, 10000);
  ship.update(0);
  assert(!ship.dead);
  assert.equal(
    ship.segments.filter((segment) => segment.hull).length,
    6,
    'damage detaches the panel and its insert while preserving unrelated pieces',
  );
}

for (const [shipType, index] of [
  ['crescent', 3],
  ['crescent', 4],
  ['crescent', 5],
  ['crescent', 6],
  ['crystal', 6],
  ['crystal', 7],
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
  const ship = createPlayerShip(world, { shipType: 'crystal' });
  const colliders = ship.hitbox();

  const core = ship.segments.find((segment) => segment.core)!;

  assert.equal(
    colliders.filter((collider) => collider.segment === core).length,
    1,
    'the Crystal core has one regular collider',
  );
  assert(
    colliders.filter((collider) => collider.segment?.hull).length <= 24,
    'Crystal outlines must not generate a dense collision mesh',
  );

  const weapon = ship.crystalWeapon!;

  for (const emitter of weapon.emitters.slice(1)) {
    const points = ship.hullSegments[emitter.hullIndex].points as number[][];
    const tip = Vec.create(...points[0]);
    const axis = Vec.subtract(tip, Vec.create(...points[2]));
    const direction = Vec.subtract(Vec.create(...weapon.junction), tip);

    assert.deepEqual(emitter.position, points[0], 'beams start at the tips');
    assert(
      Math.abs(Vec.cross(axis, direction)) < 1e-8 &&
        Vec.dot(axis, direction) > 0 &&
        axis.y * tip.y < 0,
      'side crystals point inward along their converging beams',
    );
  }
}

for (const destroyed of [[], [2], [2, 3]]) {
  const world = createWorld();
  const ship = addEntity(
    world,
    createPlayerShip(world, { shipType: 'crystal' }),
  );

  ship.firing = true;

  for (const index of destroyed) {
    damage(
      ship.segments.find(
        (segment) => segment.module === ship.hullSegments[index],
      )!,
      10000,
    );
  }

  assert.equal(crystalBeams(ship)[0].fraction, 1 - destroyed.length * 0.25);
}

{
  const world = createWorld();
  const ship = addEntity(
    world,
    createPlayerShip(world, { shipType: 'crystal' }),
  );

  const weapon = ship.crystalWeapon!;

  const blocker = addEntity(
    world,
    new Item(gold, {
      id: 100,
      position: Vec.scale(
        Vec.add(
          Vec.create(...weapon.emitters[1].position),
          Vec.create(...weapon.junction),
        ),
        0.5,
      ),
      health: 100,
      radius: 2,
    }),
  );

  ship.firing = true;
  const beams = crystalBeams(ship);

  assert.equal(beams[0].fraction, 0.75);
  assert.equal(beams[1].first?.owner, blocker);
  assert(
    beams[1].length < Vec.distance(beams[1].localStart, beams[1].localEnd),
  );
  const health = blocker.health;

  ship.resolveLasers(1 / 30, []);
  assert(
    Math.abs(health - blocker.health - ship.crystalWeapon!.damage * 0.25) <
      1e-8,
    'a blocked feeder does one quarter of full damage',
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
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { shipType: 'manta' }));
  const first = ship
    .hitbox()
    .filter((collider) => collider.segment?.module === ship.hullSegments[6])
    .map((collider) => Vec.clone(collider.position));

  world.tick = 13;
  const second = ship
    .hitbox()
    .filter((collider) => collider.segment?.module === ship.hullSegments[6]);

  assert.notDeepEqual(
    second.map((collider) => collider.position),
    first,
    'tail collision follows the joints',
  );
  assert.equal(second.length, 1, 'a tail joint uses one hidden rectangle');
  const box = second[0].shapeOutline!;
  const edgeA = Vec.create(box[1][0] - box[0][0], box[1][1] - box[0][1]);
  const edgeB = Vec.create(box[2][0] - box[1][0], box[2][1] - box[1][1]);

  assert(
    Math.abs(edgeA.x * edgeB.x + edgeA.y * edgeB.y) < 1e-8,
    'tail colliders remain rectangles as the tail bends',
  );
  const ribbon = ship.segments.filter((segment) => segment.ribbon);

  assert.equal(
    ribbon.filter((segment) => segment.ribbonPath).length,
    1,
    'the tail draws one continuous outline',
  );
  assert(
    ribbon.every((segment) =>
      segment.curvePoints.some((point: number[]) => point.length === 6),
    ),
    'the visible tail sections are cubic curves',
  );

  for (let index = 1; index < ribbon.length; index++) {
    assert.deepEqual(
      ribbon[index - 1].curvePoints[1].slice(0, 2),
      ribbon[index].curvePoints[0],
      'neighboring tail surfaces share an exact edge endpoint',
    );
    const before = ribbon[index - 1].curvePoints[1];
    const after = ribbon[index].curvePoints[1];

    assert(
      Math.hypot(
        before[0] - before[4] - (after[2] - before[0]),
        before[1] - before[5] - (after[3] - before[1]),
      ) < 1e-8,
      'neighboring tail sections have the same tangent',
    );
  }

  damage(second[0].segment!, 10000);
  ship.update(0);
  assert(!ship.dead, 'the tail can be lost without killing the manta');
  assert(
    [...world.entities.values()].some(
      (object) =>
        object instanceof Craft &&
        object.decay &&
        object.segments.some(
          (segment) =>
            Array.isArray(segment.points) && segment.points.length > 4,
        ),
    ),
    'severed tail debris retains a curved surface',
  );
  assert(
    !ship.segments.some((segment) => segment.module === ship.hullSegments[7]),
    'the tip detaches with the broken tail',
  );
  assert(ship.engines.every((engine) => engine.shades === colors.yellow));
}

{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { shipType: 'manta' }));
  const observer = createPlayerShip(world);

  const colliders = ship.hitbox().filter((collider) => collider.segment?.hull);

  assert(
    colliders.length <= 24,
    'smooth drawing curves must not generate a dense Manta collision mesh',
  );

  for (const collider of colliders) {
    const points = collider.shapeOutline!;

    const turns = points.map((a, index) => {
      const b = points[(index + 1) % points.length];
      const c = points[(index + 2) % points.length];

      return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    });

    assert(
      turns.every((turn) => turn >= -1e-8) ||
        turns.every((turn) => turn <= 1e-8),
      'coarse collision fixtures must remain convex',
    );
  }

  const insert = ship.segments.find(
    (segment) => segment.module === ship.hullSegments[8],
  )!;
  const outline = (insert.collisionParts as number[][][])[0];
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
    'shots inside a wing insert hit the cyan segment',
  );
  damage(insert, 10000);
  assert(
    !traceLaser(ray).first,
    'destroying an insert reveals an actual hole in the wing',
  );
  ship.update(0);
  assert(!ship.dead);
}

{
  const world = createWorld();
  const ship = addEntity(world, createPlayerShip(world, { shipType: 'manta' }));
  const wing = ship.segments.find(
    (segment) => segment.module === ship.hullSegments[1],
  )!;

  damage(wing, 10000);
  ship.update(0);
  assert(
    !ship.segments.some((segment) => segment.module === ship.hullSegments[8]),
    'the inset detaches with its supporting wing',
  );
}

{
  const ship = createPlayerShip(createWorld(), { shipType: 'manta' });
  const thrust = ship.forwardThrust;
  const usage = ship.engines.reduce((sum, engine) => sum + engine.fuelUsage, 0);
  const before = ship.fuel;

  ship.fly(1, 0);
  ship.consumeFuel(1);
  assert(Math.abs(before - ship.fuel - usage) < 1e-8);
  ship.engines[0].mount.health = 0;
  assert.equal(ship.forwardThrust, thrust / 2);
}

{
  const ship = createPlayerShip(createWorld(), {
    shipType: 'crystal',
    playerId: 1,
  });

  controlShip(ship, { ...emptyPlayerInput(), thrust: 1, fire: true }, []);
  assert.equal(ship.forward, 0, 'player input cannot pilot an NPC-only ship');
  assert(!ship.firing);
  assert.equal(
    ship.applyDockAction({ action: 'paint', paint: 0 }, { credits: 1000 }),
    undefined,
  );
  ship.firing = true;
  assert(ship.crystalPowerUsage > 0);

  for (const mount of ship.mounts) {
    if (mount.module && mount.module.powerGenerated) mount.health = 0;
  }

  ship.storedPower = 0;
  ship.updatePower(1 / 30);
  assert.equal(
    crystalBeams(ship).length,
    0,
    'an unpowered crystal weapon cannot fire',
  );
}
