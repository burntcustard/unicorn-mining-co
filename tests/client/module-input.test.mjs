/* global Buffer, process */
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.js';
import { stripIfdef } from '../../plugins/replace-pre-terser.js';

const scenario = `
import assert from 'node:assert/strict';
import { initKeys, playerInput } from '${process.cwd()}/src/client/input/input.ts';
import { moduleBinding } from '${process.cwd()}/src/client/input/keybindings.ts';
import { createShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
import { createWorld } from '${process.cwd()}/src/client/simulation/world.ts';
import { controlShip } from '${process.cwd()}/src/client/objects/control-ship.ts';
import { HornDrill, SearchLight, CargoHatch, ShieldGenerator } from '${process.cwd()}/src/client/objects/modules/index.ts';
globalThis.window=new EventTarget();
initKeys();
const ship=createShip(createWorld());
const shieldGenerator=new ShieldGenerator();
ship.cargoContents.push(shieldGenerator);
ship.fit(shieldGenerator,ship.mounts.find(mount=>mount.fits.includes(ShieldGenerator)));
const keyEvent=(type,key,repeat=false)=>window.dispatchEvent(Object.assign(new Event(type),{key,repeat}));
const press=key=>keyEvent('keydown',key);
const release=key=>keyEvent('keyup',key);
for(const [Type,action,label] of [[HornDrill,'hornDrill','HORN DRILL'],[SearchLight,'searchLight','SEARCH LIGHT'],[CargoHatch,'cargoHatch','CARGO HATCH'],[ShieldGenerator,'shieldGenerator','SHIELD GENERATOR']]){
  assert.equal(Type.label,label,'module label uses terminology');
  const binding=moduleBinding(action);
  assert(Array.isArray(binding.keys) && binding.mode==='toggle');
  const key=binding.keys[0].toUpperCase();
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
assert(!ship.moduleActive({module:SearchLight}),'there are no hidden module key aliases');
console.log('Horn drill, search light, cargo hatch and shield generator key toggles passed');`;

const entryId = `${process.cwd()}/src/__module_input_test.ts`;

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entryId,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'input-test',
        resolveId: (id) => (id === entryId ? entryId : undefined),
        load(id) {
          if (id === entryId) {
            return production
              ? stripIfdef(
                  scenario.replace(
                    /assert\.(\w+)/g,
                    (_, method) => `Reflect.get(assert, '${method}')`,
                  ),
                )
              : scenario;
          }

          if (id.endsWith('/src/client/audio/sound-loader.ts')) {
            return 'export const unlockAudio=()=>{};export const playSound=()=>{};';
          }
        },
      },
      buildPrePlugin(),
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });
  const { output } = await bundle.generate({
    format: 'esm',
    minify: production,
  });

  await bundle.close();
  const code = output[0].code;

  await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
}
