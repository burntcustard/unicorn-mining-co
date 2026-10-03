import * as Vec from '../../../src/client/utilities/vector';
import { BroadPhase } from '../../../src/client/collision/broad-phase';
import { AABB } from '../../../src/client/collision/axis-aligned-bounds';
import { Fixture } from '../../../src/client/physics/fixture';
import { World } from '../../../src/client/physics/world';
import { CircleShape } from '../../../src/client/collision/shape/circle-shape';
import { createRandom } from '../../../src/client/utilities/seeded-random';

const random = createRandom(7149);
const broad = new BroadPhase();
const world = new World();
const owners = Array.from({ length: 8 }, () => world.createBody());
const proxies = new Map<number, ReturnType<BroadPhase['createProxy']>>();

const box = (x: number, y: number, radius: number) => {
  const bounds = new AABB();

  Vec.setXY(bounds.lowerBound, x - radius, y - radius);
  Vec.setXY(bounds.upperBound, x + radius, y + radius);
  return bounds;
};

type Operation = {
  kind: 'create' | 'move' | 'destroy' | 'buffer' | 'pairs' | 'query';
  id?: number;
  owner?: number;
  bounds?: AABB;
  displacement?: Vec.Value;
  nested?: AABB;
  limit?: number;
};

const records: object[] = [];

const run = (op: Operation) => {
  const pairs: unknown[] = [];
  const hits: number[] = [];
  const nestedHits: number[] = [];

  switch (op.kind) {
    case 'create': {
      const fixture = new Fixture(
        owners[op.owner!],
        new CircleShape(Vec.create(), 1),
        { userData: op.id },
      );

      proxies.set(op.id!, broad.createProxy(op.bounds!, fixture));
      break;
    }

    case 'move':
      broad.moveProxy(proxies.get(op.id!)!, op.bounds!, op.displacement!);
      break;

    case 'destroy':
      broad.destroyProxy(proxies.get(op.id!)!);
      proxies.delete(op.id!);
      break;

    case 'buffer':
      broad.bufferMove(proxies.get(op.id!)!);
      break;

    case 'pairs':
      broad.updatePairs((a, b) => pairs.push([a.m_userData, b.m_userData]));
      break;

    case 'query':
      broad.m_grid.query(
        op.bounds!,
        (proxy) => {
          hits.push(proxy.userData.m_userData as number);

          if (hits.length === 1 && op.nested) {
            broad.m_grid.query(op.nested, (nested) => {
              nestedHits.push(nested.userData.m_userData as number);
              return true;
            });
          }

          return !op.limit || hits.length < op.limit;
        },
        op.owner === undefined ? undefined : owners[op.owner],
      );

      break;
  }

  records.push({
    ...op,
    pairs,
    hits,
    nestedHits,
    proxies: structuredClone(
      [...proxies].map(([id, proxy]) => ({
        id,
        proxyId: proxy.id,
        bounds: proxy.aabb,
      })),
    ),
  });
};

for (let id = 1; id <= 12; id++) {
  run({
    kind: 'create',
    id,
    owner: id % owners.length,
    bounds: box(id, 0, 20),
  });
}

run({ kind: 'buffer', id: 3 });
run({ kind: 'buffer', id: 3 });
run({ kind: 'destroy', id: 3 });
run({ kind: 'pairs' });

run({
  kind: 'query',
  bounds: box(0, 0, 100),
  nested: box(0, 0, 100),
  limit: 3,
});

let nextId = 13;

for (let tick = 0; tick < 400; tick++) {
  const ids = [...proxies.keys()];
  const id = ids[Math.floor(random.next() * ids.length)];
  const x = Math.floor(random.next() * 1024) - 512;
  const y = Math.floor(random.next() * 1024) - 512;
  const bounds = box(x, y, 10 + random.next() * 180);

  if (tick % 7 === 0 && ids.length < 24) {
    run({ kind: 'create', id: nextId++, owner: tick % owners.length, bounds });
  } else if (tick % 11 === 0 && ids.length > 8) {
    run({ kind: 'destroy', id });
  } else {
    run({ kind: 'move', id, bounds, displacement: Vec.create(x / 8, y / 8) });
  }

  if (tick % 4 === 0) run({ kind: 'pairs' });

  if (tick % 5 === 0) {
    run({
      kind: 'query',
      bounds,
      owner: tick % owners.length,
      nested: box(-256, 256, 512),
    });
  }
}

run({ kind: 'pairs' });
export default records;
