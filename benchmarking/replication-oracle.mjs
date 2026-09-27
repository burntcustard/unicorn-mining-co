/* global process */
import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.slice(2).split('=')),
);

if (!options.reference) {
  throw new Error('--reference must name the previous replication.ts');
}
const directory = await mkdtemp(join(tmpdir(), 'replication-oracle-'));
const outputFile = join(directory, 'oracle.mjs');

try {
  const reference = resolve('src/server/__replication_reference.ts');
  const entry = resolve('src/server/__replication_oracle.ts');
  const before = await readFile(options.reference, 'utf8');
  const bundle = await rolldown({
    input: entry,
    platform: 'node',
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'oracle',
        resolveId(id) {
          if (id === reference || id === entry) return id;

          if (id === 'ws') {
            return {
              id: resolve('node_modules/ws/wrapper.mjs'),
              external: true,
            };
          }
        },
        load(id) {
          if (id === reference) return before;

          if (id === entry) {
            return `
import assert from 'node:assert/strict';
import {ReplicationManager} from './replication';
import {ReplicationManager as Reference} from '${reference}';
export {GameSession} from './game-session';
const histories = new WeakMap();
const snapshot = ReplicationManager.prototype.snapshot;
let checked=0, differentDeltas=0;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
function apply(state, packet) {
 for(const record of packet.fullEntities){
   let target=state.get(record.id);
   if(!target)state.set(record.id,target={});
   for(const [key,value] of Object.entries(record)){if(value===null)delete target[key];else target[key]=value;}
 }
 if(packet.entityIds)for(const id of state.keys())if(!packet.entityIds.includes(id))state.delete(id);
 return canonical([...state].sort((a,b)=>a[0]-b[0]));
}
ReplicationManager.prototype.snapshot=function(options){
 let history=histories.get(this);
 if(!history)histories.set(this,history={reference:new Reference(),actual:new Map(),expected:new Map()});
 const result=snapshot.call(this,options);
 const actual=JSON.parse(JSON.stringify(result));
 const expected=JSON.parse(JSON.stringify(history.reference.snapshot({...options,replicationRecords:undefined})));
 if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(expected)))differentDeltas++;
 assert.deepEqual(apply(history.actual,actual),apply(history.expected,expected));
 checked++;
 return result;
};
process.on('exit',()=>console.error(JSON.stringify({checked,differentDeltas})));
`;
          }
        },
      },
    ],
  });

  await bundle.write({ file: outputFile, format: 'esm' });
  await bundle.close();

  const child = spawnSync(
    process.execPath,
    [
      '--max-semi-space-size=16',
      resolve('benchmarking/three-player-flight.mjs'),
      '--bundle=' + outputFile,
      '--scenario=' + (options.scenario || 'convoy'),
      '--ticks=' + (options.ticks || 3600),
    ],
    { stdio: 'inherit', timeout: 290000 },
  );

  if (child.status !== 0) {
    throw new Error(
      `Replication oracle failed: ${child.error || child.status}`,
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
