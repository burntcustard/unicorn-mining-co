import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  decodeBinarySnapshot,
  BinaryField,
} from '../../src/client/protocol/binary-snapshot';

const output = execFileSync(
  'go',
  ['run', 'src/server/testtools/snapshot/main.go'],
  { encoding: 'utf8' },
);
const packet = Buffer.from(output.trim(), 'hex');
const snapshot = decodeBinarySnapshot(packet);

assert.equal(snapshot.type, 'snapshot');
assert.equal(snapshot.serverTick, 42);
assert.equal(snapshot.nextEntityId, 100);
assert.equal(snapshot.acknowledgedSequence, 9);
assert.equal(snapshot.inputLead, -2);
assert.equal(snapshot.snapshotSequence, 10);
assert.deepEqual(snapshot.entityIds, [7, 9]);
assert.equal(snapshot.fullEntities.length, 2);
const [ship, asteroid] = snapshot.fullEntities;

assert.equal(ship.id, 7);
assert.equal(ship.definitionId, 'testScout');
assert.equal(ship.kind, 'ship');
assert.deepEqual(ship.position, { x: -1.25, y: 20.5 });
assert.deepEqual(ship.velocity, { x: 3, y: -4 });
assert.deepEqual(ship.hullHealth, [8, 20, 40]);
assert.equal(ship.modules?.[0].segments[0].activationProgress, 0.5);
assert.equal(ship.cargoContents?.length, 2);
assert.deepEqual(ship.cargoContents?.[0], { moduleIndex: 2 });
assert(ship.cargoContents);

assert.equal((ship.cargoContents[1] as { id: number }).id, 25);

assert.equal(ship.wreckage?.[0].fillShade, 2);
assert.equal(asteroid.kind, 'asteroid');
assert.deepEqual(asteroid.contents, [0, 2]);
assert.equal(asteroid.segments?.[0].health, 10);
assert.equal(asteroid.message, null);
assert.equal(BinaryField.velocity, 33);
console.log('Go UM snapshot decoded by TypeScript');
