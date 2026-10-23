import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as Vec from '../../src/client/utilities/vector.ts';

export type ProtocolCatalog = {
  moduleIds: string[];
  modules: Record<
    string,
    { fireInterval?: number; activationDuration?: number }
  >;
  ships: Record<
    string,
    {
      mounts: string[][];
      drillTipsByMount: ({
        position: Vec.Value;
        radius: number;
      } | null)[];
      cargoSpace: number;
      drag: number;
    }
  >;
  stations: Record<
    string,
    { dockingBays: number[]; localMovementRadius: number }
  >;
  ammoRounds: number;
  ammoResource: number;
};

export type ProtocolRuntime = {
  encodeClientMessage: typeof import('../../src/client/protocol/binary-control.ts').encodeClientMessage;
  decodeServerControl: typeof import('../../src/client/protocol/binary-control.ts').decodeServerControl;
  decodeBinarySnapshot: typeof import('../../src/client/protocol/binary-snapshot.ts').decodeBinarySnapshot;
  sameInput: typeof import('../../src/client/protocol/input.ts').sameInput;
  catalog: ProtocolCatalog;
};

/*
 * Bundle the normal game codec and catalog, without changing its wire format.
 */
export async function loadProtocolRuntime(directory: string) {
  await mkdir(directory, { recursive: true });
  const source = [
    `export {encodeClientMessage,decodeServerControl} from ${JSON.stringify(resolve('src/client/protocol/binary-control.ts'))};`,
    `export {decodeBinarySnapshot} from ${JSON.stringify(resolve('src/client/protocol/binary-snapshot.ts'))};`,
    `export {sameInput} from ${JSON.stringify(resolve('src/client/protocol/input.ts'))};`,
    `import {moduleIds,moduleSpecs} from ${JSON.stringify(resolve('src/specs/modules/index.ts'))};`,
    `import {shipSpecs} from ${JSON.stringify(resolve('src/specs/ships/index.ts'))};`,
    `import {stationSpecs} from ${JSON.stringify(resolve('src/specs/stations/index.ts'))};`,
    `import {autogunAmmo} from ${JSON.stringify(resolve('src/specs/items/index.ts'))};`,
    `export const catalog={moduleIds,ammoRounds:autogunAmmo.rounds,ammoResource:autogunAmmo.resource,modules:Object.fromEntries(Object.entries(moduleSpecs).map(([id,spec])=>[id,{fireInterval:spec.fireInterval,activationDuration:spec.activationDuration}])),ships:Object.fromEntries(Object.entries(shipSpecs).map(([id,spec])=>[id,{cargoSpace:spec.cargoSpace,drag:spec.drag,mounts:spec.hullSegments.flatMap(segment=>(segment.mounts||[]).map(group=>[...new Set(group.flatMap(mount=>mount.fits))])),drillTipsByMount:spec.hullSegments.flatMap(segment=>(segment.mounts||[]).map(group=>{const mount=group.find(mount=>mount.fits.includes('hornDrill'));const tip=moduleSpecs.hornDrill.drillTip;return mount?{position:{x:mount.x+tip.position.x,y:mount.y+tip.position.y},radius:tip.radius}:null}))}])),stations:Object.fromEntries(Object.entries(stationSpecs).map(([id,spec])=>[id,{dockingBays:spec.dockingBays,localMovementRadius:spec.localMovementRadius}]))};`,
  ].join('\n');
  const entry = resolve(directory, 'protocol-entry.ts');
  const runtimePath = resolve(directory, 'protocol-runtime.mjs');

  await writeFile(entry, source);
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({ input: entry });

  try {
    await bundle.write({ file: runtimePath, format: 'esm' });
  } finally {
    await bundle.close();
  }

  const runtime: ProtocolRuntime = await import(
    pathToFileURL(runtimePath).href
  );

  return { runtime, runtimePath };
}
