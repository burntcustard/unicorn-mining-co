import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeServerControl } from '../../src/client/protocol/binary-control';
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

function decoded(packet: string) {
  const data = Buffer.from(packet, 'hex');

  if (data[1] === 0x43) {
    const message = decodeServerControl(data);

    if (message.type === 'welcome') message.playerToken = 'token';
    return message;
  }

  return decodeBinarySnapshot(data);
}

function compare(a: unknown, b: unknown, path: string) {
  if (typeof a === 'number' && typeof b === 'number') {
    assert(Math.abs(a - b) <= 2e-8, `${path}: ${a} != ${b}`);
    return;
  }

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);

    for (const key of Object.keys(a)) {
      compare(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
  } else assert.deepEqual(a, b, path);
}

let packets = 0;
let progressPackets = 0;

for (const [id, socket] of Object.entries(fixture.sockets) as [
  string,
  { code: number; packets: string[] },
][]) {
  assert.equal(go[id].code, socket.code);

  // The archived session predates authoritative paint notifications. Check
  // that addition separately and retain every recorded mechanics comparison.
  const actualPackets = go[id].packets.filter((packet: string) => {
    const data = Buffer.from(packet, 'hex');

    if (data[1] === 0x43) {
      const message = decodeServerControl(data);

      if (message.type === 'progress') {
        assert.equal(id, '4');
        assert.equal(message.unlockedPaints, 116);
        progressPackets++;
        return false;
      }
    }

    return true;
  });

  assert.equal(actualPackets.length, socket.packets.length);

  socket.packets.forEach((packet, index) => {
    compare(
      decoded(actualPackets[index]),
      decoded(packet),
      `socket ${id} packet ${index}`,
    );
    packets++;
  });
}

assert.equal(progressPackets, 1);

console.log(
  `Go session matches ${packets} recorded packets: input, reconnect, catch-up, backpressure, docking and respawn`,
);
