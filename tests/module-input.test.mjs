/* global Buffer, process */
import { rolldown } from 'rolldown';
import { minify } from 'terser';
import { terserMangleOptions, viteBuildPre } from '../plugins/vite-build.js';
import { replacePreTerser } from '../plugins/replace-pre-terser.js';

const scenario = `
import assert from 'node:assert/strict';
import {initKeys,playerInput} from '${process.cwd()}/src/client/input.ts';
import {createShip} from '${process.cwd()}/src/shared/craft/create-ship.ts';
import {createWorld} from '${process.cwd()}/src/shared/simulation/world.ts';
import {controlShip} from '${process.cwd()}/src/shared/craft/control-ship.ts';
import {Horn,Light,CargoScoop,Shield} from '${process.cwd()}/src/shared/modules/index.ts';
globalThis.window=new EventTarget();
initKeys();
const ship=createShip(createWorld());
const shield=new Shield();
ship.cargoContents.push(shield);
ship.fit(shield,ship.mounts.find(mount=>mount.fits.includes(Shield)));
const keyEvent=(type,key,repeat=false)=>window.dispatchEvent(Object.assign(new Event(type),{key,repeat}));
const press=key=>keyEvent('keydown',key);
const release=key=>keyEvent('keyup',key);
for(const Type of [Horn,Light,CargoScoop,Shield]){
  const key=Type.label[0];
  press(key);
  controlShip(ship,playerInput,[]);
  assert(ship.moduleActive({module:Type}),key+' activates its fitted module');
  release(key);
  controlShip(ship,playerInput,[]);
  assert(ship.moduleActive({module:Type}),key+' stays toggled after release');
  keyEvent('keydown',key,true);
  controlShip(ship,playerInput,[]);
  assert(ship.moduleActive({module:Type}),'key repeat does not retoggle');
  press(key);
  controlShip(ship,playerInput,[]);
  assert(!ship.moduleActive({module:Type}),key+' toggles off');
  release(key.toLowerCase());
}
press('f');
controlShip(ship,playerInput,[]);
assert(!ship.moduleActive({module:Light}),'there are no hidden module key aliases');
console.log('Drill, light, hatch and shield keyboard-to-simulation toggles passed');
`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: 'input-test',
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'input-test',
        resolveId: (id) => (id === 'input-test' ? '\0input-test' : undefined),
        load(id) {
          if (id === '\0input-test') {
            return production ? replacePreTerser(scenario) : scenario;
          }

          if (id.endsWith('/src/client/sound-loader.ts')) {
            return 'export const unlockAudio=()=>{};';
          }
        },
      },
      ...(production ? [viteBuildPre()] : []),
    ],
  });
  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  const code = production
    ? (await minify(output[0].code, terserMangleOptions())).code
    : output[0].code;

  await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
}
