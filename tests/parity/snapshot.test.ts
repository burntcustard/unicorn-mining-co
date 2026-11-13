import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  decodeBinarySnapshot,
  mergeModuleStates,
  BinaryField,
} from '../../src/client/protocol/binary-snapshot';

const output = execFileSync(
  'go',
  ['run', 'src/server/testtools/snapshot/main.go'],
  { encoding: 'utf8' },
);
const packets: Record<string, string> = JSON.parse(output);
const snapshot = decodeBinarySnapshot(Buffer.from(packets.snapshot, 'hex'));
const edge = decodeBinarySnapshot(Buffer.from(packets.edge, 'hex'));
const edgeModules = edge.fullEntities[0].modules!;

assert.deepEqual(edge.fullEntities[0].position, { x: 1.1, y: 2.2 });
assert.deepEqual(edge.fullEntities[0].velocity, { x: 0, y: null });
assert.equal(edge.fullEntities[0].rotation, null);
assert.equal(edge.fullEntities[0].spin, null);
assert.deepEqual(edgeModules[0].shades, [
  '#c2c',
  '#d3d',
  '#e6f',
  '#427',
  '#e6f',
]);
assert.equal(Object.is(edgeModules[0].segments[2].active, -0), false);
assert.equal(edgeModules[0].segments[2].activationProgress, null);
assert.equal(edgeModules[0].segments[3].active, null);
assert.equal(edgeModules[0].segments[3].activationProgress, null);
assert.equal(edgeModules[1].type, 2 ** 52 - 1);
assert.equal(edgeModules[1].mount, -(2 ** 52 - 1));
assert.equal(edgeModules[1].id, 2 ** 52 - 1);

assert.equal(snapshot.type, 'snapshot');
assert.equal(snapshot.serverTick, 42);
assert.equal(snapshot.nextEntityId, 100);
assert.equal(snapshot.acknowledgedSequence, 9);
assert.equal(snapshot.inputLead, -2);
assert.equal(snapshot.snapshotSequence, 10);
assert.deepEqual(snapshot.entityIds, [7, 9, 11, 13]);
assert.deepEqual(snapshot.asteroidPositions, [
  { x: -2999, y: 2 },
  { x: 2999, y: 3 },
]);
assert.equal(snapshot.fullEntities.length, 4);
const [ship, asteroid, projectile, beacon] = snapshot.fullEntities;

assert.equal(beacon.kind, 'navBeacon');
assert.deepEqual(beacon.position, { x: 100, y: 200 });
assert.equal(beacon.rotation, 0.25);

assert.equal(ship.targetLabel, 'CUSTOM\nTARGET LABEL');
assert.equal(ship.blockedBeams, 10);
assert.equal(ship.transitTime, -1.25);
assert.equal(ship.transitGate, 987);

assert.equal(projectile.kind, 'projectile');
assert.equal(projectile.definitionId, 'autogun');
assert.equal(projectile.health, 1.25);
assert.equal(ship.modules?.[0].type, 12);
assert.equal(ship.modules?.[0].fireCooldown, 0.375);
assert.equal(ship.modules?.[0].chargeCooldown, 1.125);
assert.equal(ship.modules?.[0].aimRotation, 0.75);

assert.equal(ship.id, 7);
assert.equal(ship.definitionId, 'testScout');
assert.equal(
  ship.name,
  'MUSTANG',
  'display names and spec identifiers remain separate on the wire',
);
assert.equal(ship.kind, 'ship');
assert.equal(ship.hostile, true);
assert.equal(ship.npcState, 'Collecting');
assert.equal(ship.fuel, 3.25);
assert.equal(ship.storedPower, 12.5);
assert.deepEqual(ship.position, { x: -1.25, y: 20.5 });
assert.deepEqual(ship.velocity, { x: 3, y: -4 });
assert.equal(ship.rotation, 0.25);
assert.equal(ship.spin, -0.5);
assert.deepEqual(ship.hullHealth, [8, 20, 40]);
assert.equal(ship.modules?.[0].segments[0].activationProgress, 0.5);
assert.equal(ship.cargoContents?.length, 2);
assert.deepEqual(ship.cargoContents?.[0], { moduleIndex: 2 });
assert(ship.cargoContents);

assert.equal((ship.cargoContents[1] as { id: number }).id, 25);

assert.equal((ship.cargoContents[1] as { rounds: number }).rounds, 137);

assert.equal(ship.wreckage?.[0].fillShade, 2);
assert.equal(ship.wreckage?.[0].color, '#fa3');
assert.equal(asteroid.kind, 'asteroid');
assert.deepEqual(asteroid.contents, [0, 2]);
assert.equal(asteroid.segments?.[0].health, 10);
assert.equal(asteroid.message, null);
assert.equal(BinaryField.velocity, 33);
console.log('Go UM snapshot decoded by TypeScript');

// These packets come from the Go encoder, including a stale observer whose
// baseline predates both the repaint and the later animation change.
const decodedModuleRecord = (key: string) =>
  decodeBinarySnapshot(Buffer.from(packets[key], 'hex')).fullEntities[0];
const loadedModules = decodedModuleRecord('moduleLoad');
const paintedModules = decodedModuleRecord('modulePaint');

mergeModuleStates(paintedModules, loadedModules);
assert.deepEqual(paintedModules.modules?.[1].shades, [
  '#c2c',
  '#d3d',
  '#e6f',
  '#427',
  '#e6f',
]);
const animatedModules = decodedModuleRecord('moduleAnimation');

mergeModuleStates(animatedModules, paintedModules);
assert.equal(animatedModules.modules?.[0].segments[0].activationProgress, 0.75);
const staleModules = decodedModuleRecord('moduleStale');

mergeModuleStates(staleModules, loadedModules);
assert.deepEqual(staleModules.modules, animatedModules.modules);
const clearedModules = decodedModuleRecord('moduleClear');

mergeModuleStates(clearedModules, animatedModules);
assert.equal(clearedModules.modules?.[1].shades, undefined);
const reentryModules = decodedModuleRecord('moduleReentry');

mergeModuleStates(reentryModules);
assert.deepEqual(
  reentryModules.modules?.map((module) => module.id),
  [3, 1],
);
const cargoModules = decodedModuleRecord('moduleCargo').cargoContents?.[0];

assert(cargoModules && 'modules' in cargoModules);
assert.deepEqual(
  cargoModules.modules?.[1].shades,
  paintedModules.modules?.[1].shades,
);
