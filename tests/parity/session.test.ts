import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeServerControl } from '../../src/client/protocol/binary-control';
import { diamond, itemTypes } from '../../src/specs/items';
import {
  moduleIds,
  moduleSpecList,
  searchLight,
} from '../../src/specs/modules';
import { decodeBinarySnapshot } from '../../src/client/protocol/binary-snapshot';

const fixture = JSON.parse(
  gunzipSync(readFileSync('tests/fixtures/session.json.gz')).toString(),
);

const go = JSON.parse(
  execFileSync('go', ['run', './src/server/testtools/session'], {
    input: JSON.stringify(fixture.actions),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);

function decoded(packet: string, historical = false) {
  const data = Buffer.from(packet, 'hex');

  if (data[1] === 0x43) {
    const message = decodeServerControl(data);

    if (message.type === 'welcome') message.playerToken = 'token';
    return message;
  }

  const snapshot = decodeBinarySnapshot(data);

  // Historical item labels are now reconstructed from their resource spec.
  const adaptHistoricalEntity = (entity: any) => {
    // Housing parts share the beam's activation state. The archive predates
    // the visible model, so expand only its old one-segment records.
    if (historical) {
      entity.modules?.forEach((module: any) => {
        const spec = moduleSpecList[module.type];

        if (
          module.mount >= 0 &&
          'healthActivated' in spec &&
          spec.healthActivated !== undefined
        ) {
          module.healthActivated =
            spec.health === 0
              ? (module.health ?? spec.healthActivated)
              : spec.healthActivated;
        }

        if (module.mount < 0 && spec.health === 0) module.health = 0;

        if (
          module.type === moduleIds.indexOf('searchLight') &&
          module.segments.length === 1
        ) {
          module.segments.push(
            ...searchLight.model.map(() => ({ ...module.segments[0] })),
          );
        }
      });
    }

    if (
      entity.kind === 'item' &&
      entity.resource !== undefined &&
      entity.label === itemTypes[entity.resource]?.name.toUpperCase()
    ) {
      delete entity.label;

      if (entity.resource === 0 && entity.id === 123456) {
        entity.radius = Math.max(
          ...diamond.points.map(([x, y]) => Math.hypot(x, y)),
        );
      }
    }

    entity.cargoContents?.forEach((cargo: any) => {
      if (!('moduleIndex' in cargo)) adaptHistoricalEntity(cargo);
    });
  };

  snapshot.fullEntities.forEach(adaptHistoricalEntity);
  return snapshot;
}

function compare(a: unknown, b: unknown, path: string) {
  if (typeof a === 'number' && typeof b === 'number') {
    assert(Math.abs(a - b) <= 2e-8, `${path}: ${a} != ${b}`);
    return;
  }

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);

    for (const key of Object.keys(a)) {
      const actual = a as Record<string, unknown>;
      const archived = b as Record<string, unknown>;

      // The archive snapped docked ships to the station angle. Arrival-angle
      // preservation is covered by the client and Go docking regressions.
      if (
        key === 'rotation' &&
        actual.kind === 'ship' &&
        actual.dockedTo &&
        archived.dockedTo
      ) {
        continue;
      }

      compare(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
  } else assert.deepEqual(a, b, path);
}

let packets = 0;

const progress: { unlockedPaints: number; credits?: number }[] = [];

function snapshots() {
  const entities = new Map<number, Record<string, unknown>>();
  let sequence = 0;

  return (message: ReturnType<typeof decoded>, refresh = true) => {
    if (message.type !== 'load' && message.type !== 'snapshot') return message;

    assert.equal(message.snapshotSequence, ++sequence);

    if (!refresh) return message;

    if (message.type === 'load') entities.clear();

    if (message.entityIds) {
      for (const id of entities.keys()) {
        if (!message.entityIds.includes(id)) entities.delete(id);
      }
    }

    for (const entity of message.fullEntities) {
      const state: Record<string, unknown> = {
        ...entities.get(entity.id),
        ...entity,
      };

      for (const key of Object.keys(state)) {
        if (state[key] === null) delete state[key];
      }

      entities.set(entity.id, state);
    }

    const { snapshotSequence: _, entityIds: __, ...metadata } = message;

    return {
      ...metadata,
      fullEntities: [...entities.values()].sort(
        (a, b) => (a.id as number) - (b.id as number),
      ),
    };
  };
}

for (const [id, socket] of Object.entries(fixture.sockets) as [
  string,
  { code: number; packets: string[] },
][]) {
  assert.equal(go[id].code, socket.code);
  const actualState = snapshots();
  const archivedState = snapshots();
  let previous: ReturnType<typeof actualState>;
  let rejectedActions = 0;

  const actualPackets = go[id].packets.flatMap((packet: string) => {
    const message = decoded(packet);

    if (message.type === 'welcome') {
      assert.equal(message.credits, 2000);
      assert.equal(message.unlockedPaints, 100);
      const { credits: _, unlockedPaints: __, ...welcome } = message;

      return [welcome];
    }

    if (message.type === 'progress') {
      assert.equal(id, '4');

      progress.push({
        unlockedPaints: message.unlockedPaints,
        credits: message.credits,
      });

      return [];
    }

    // The occupied-mount equip and locked module paint now explicitly reject
    // optimistic changes with a full load of the unchanged authoritative state.
    if (
      id === '4' &&
      message.type === 'load' &&
      (message.snapshotSequence === 8 || message.snapshotSequence === 9)
    ) {
      actualState(message, false);
      assert(previous.type === 'snapshot');
      compare(
        message.fullEntities.find((entity) => entity.id === 1),
        previous.fullEntities.find((entity) => entity.id === 1),
        `rejected action ${id} ship`,
      );
      rejectedActions++;
      return [];
    }

    const state = actualState(message);

    previous = state;
    return [state];
  });

  assert.equal(rejectedActions, id === '4' ? 2 : 0);
  assert.equal(actualPackets.length, socket.packets.length);

  socket.packets.forEach((packet, index) => {
    compare(
      actualPackets[index],
      archivedState(decoded(packet, true)),
      `socket ${id} packet ${index}`,
    );
    packets++;
  });
}

// Repair costs 7, selling the diamond earns 80, and buying the shield costs
// 900. Rejected actions and equipment changes leave the player balance intact.
assert.deepEqual(progress, [
  { unlockedPaints: 100, credits: 9993 },
  { unlockedPaints: 100, credits: 9993 },
  { unlockedPaints: 116, credits: 10073 },
  { unlockedPaints: 116, credits: 9173 },
  { unlockedPaints: 116, credits: 9173 },
  { unlockedPaints: 116, credits: 9173 },
  { unlockedPaints: 116, credits: 9173 },
]);

console.log(
  `Go session matches ${packets} recorded states: input, reconnect, catch-up, backpressure, docking and respawn; player account updates and rejected actions verified`,
);
