import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeServerControl } from '../../src/client/protocol/binary-control';
import {
  decodeBinarySnapshot,
  mergeModuleStates,
} from '../../src/client/protocol/binary-snapshot';
import type { ReplicatedEntity } from '../../src/client/protocol/network';

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

function decoded(packet: string, records: Map<number, ReplicatedEntity>) {
  const data = Buffer.from(packet, 'hex');
  const message =
    data[1] === 0x43 ? decodeServerControl(data) : decodeBinarySnapshot(data);

  if (message.type === 'welcome') message.playerToken = 'token';

  if (message.type === 'load' || message.type === 'snapshot') {
    if (message.type === 'load') records.clear();

    message.fullEntities.forEach((entity) => {
      const previous = records.get(entity.id);

      mergeModuleStates(entity, previous);
      const current = { ...previous, ...entity } as ReplicatedEntity;

      Object.entries(entity).forEach(([key, value]) => {
        if (value === null) {
          delete (current as unknown as Record<string, unknown>)[key];
        }
      });

      records.set(entity.id, current);
    });

    if (message.entityIds) {
      const visible = new Set(message.entityIds);

      records.forEach((_, id) => {
        if (!visible.has(id)) records.delete(id);
      });
    }

    message.fullEntities.sort((a, b) => a.id - b.id);
  }

  // Match JSON's omission of undefined fields without changing saved values.
  return JSON.parse(JSON.stringify(message));
}

function compare(actual: unknown, expected: unknown, path: string) {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert(
      Math.abs(actual - expected) <= 2e-8,
      `${path}: ${actual} != ${expected}`,
    );
    return;
  }

  if (
    actual &&
    expected &&
    typeof actual === 'object' &&
    typeof expected === 'object'
  ) {
    const actualFields = actual as Record<string, unknown>;
    const expectedFields = expected as Record<string, unknown>;

    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(expected).sort(),
      path,
    );

    for (const key of Object.keys(actual)) {
      compare(actualFields[key], expectedFields[key], `${path}.${key}`);
    }
  } else {
    assert.deepEqual(actual, expected, path);
  }
}

assert.deepEqual(Object.keys(go).sort(), Object.keys(fixture.sockets).sort());
let packets = 0;

for (const [id, socket] of Object.entries(fixture.sockets) as [
  string,
  { code: number; messages: unknown[] },
][]) {
  assert.equal(go[id].code, socket.code);
  assert.equal(go[id].packets.length, socket.messages.length);

  const records = new Map<number, ReplicatedEntity>();

  socket.messages.forEach((expected, index) => {
    const actual = decoded(go[id].packets[index], records);
    const comparable = { ...(expected as Record<string, unknown>) };

    // Receipt requests are optional; every present sequence and all gameplay
    // fields still match the fixture. Loads must always request a receipt.
    if (actual.type === 'snapshot' && actual.snapshotSequence === undefined) {
      delete comparable.snapshotSequence;
    }

    compare(actual, comparable, `socket ${id} packet ${index}`);
    packets++;
  });
}

console.log(
  `Go session matches ${packets} fixed current messages: input, reconnect, catch-up, backpressure, docking, account updates and respawn`,
);
