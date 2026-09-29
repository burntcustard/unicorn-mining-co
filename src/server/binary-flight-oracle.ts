import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { BinaryReplicationManager } from './binary-replication';
import { ReplicationManager } from './replication';
import { decodeBinarySnapshot } from '../shared/protocol/binary-snapshot';
import type {
  ReplicatedEntity,
  ServerMessage,
} from '../shared/protocol/network';

type Snapshot = Extract<ServerMessage, { type: 'load' | 'snapshot' }>;
type Options = Parameters<BinaryReplicationManager['snapshot']>[0];
type History = {
  reference: ReplicationManager;
  binaryState: Map<number, ReplicatedEntity>;
  jsonState: Map<number, ReplicatedEntity>;
};

const stateAfter = (state: Map<number, ReplicatedEntity>, packet: Snapshot) => {
  if (packet.type === 'load') state.clear();

  for (const record of packet.fullEntities) {
    const merged = { ...state.get(record.id), ...record };

    for (const [key, value] of Object.entries(record)) {
      if (value === null) delete (merged as Record<string, unknown>)[key];
    }
    state.set(record.id, merged);
  }
  const visible = new Set(packet.entityIds ?? state.keys());

  for (const id of state.keys()) if (!visible.has(id)) state.delete(id);
  return [...state].sort(([a], [b]) => a - b);
};

export const installBinaryFlightOracle = () => {
  const histories = new WeakMap<BinaryReplicationManager, History>();
  // Both saved methods are invoked with their original receiver below.
  // oxlint-disable-next-line typescript/unbound-method
  const originalInitial = BinaryReplicationManager.prototype.initial;
  // oxlint-disable-next-line typescript/unbound-method
  const originalSnapshot = BinaryReplicationManager.prototype.snapshot;
  let checked = 0;

  const check = (
    manager: BinaryReplicationManager,
    options: Options,
    initial: boolean,
    packet: Uint8Array,
  ) => {
    let history = histories.get(manager);

    if (!history) {
      history = {
        reference: new ReplicationManager(),
        binaryState: new Map(),
        jsonState: new Map(),
      };
      histories.set(manager, history);
    }
    const referenceOptions = {
      world: options.world,
      shipId: options.shipId,
      position: options.position,
      acknowledgedSequence: options.acknowledgedSequence,
      inputLead: options.inputLead,
    };
    const reference = initial
      ? history.reference.initial(referenceOptions)
      : history.reference.snapshot(referenceOptions);

    if (reference.type !== 'load' && reference.type !== 'snapshot') {
      throw new Error('Expected reference snapshot');
    }
    const expected = JSON.parse(
      JSON.stringify({
        ...reference,
        snapshotSequence: options.snapshotSequence,
      }),
    ) as Snapshot;
    const actual = decodeBinarySnapshot(packet);

    assert(
      isDeepStrictEqual(actual, expected),
      `binary packet ${checked}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
    );
    assert(
      isDeepStrictEqual(
        stateAfter(history.binaryState, actual),
        stateAfter(history.jsonState, expected),
      ),
      `binary receiver state ${checked}`,
    );
    checked++;
  };

  BinaryReplicationManager.prototype.initial = function (options) {
    const packet = originalInitial.call(this, options);

    check(this, options, true, packet);
    return packet;
  };
  BinaryReplicationManager.prototype.snapshot = function (options) {
    const packet = originalSnapshot.call(this, options);

    check(this, options, false, packet);
    return packet;
  };
  process.on('exit', () => {
    console.error(`BINARY_FLIGHT_ORACLE checked=${checked}`);
  });
};
