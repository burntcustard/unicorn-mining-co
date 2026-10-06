/* global Buffer, process */
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const scenario = `
import assert from 'node:assert/strict';
import { initKeys, playerInput } from '${process.cwd()}/src/client/input/input.ts';
import { moduleBinding } from '${process.cwd()}/src/client/input/keybindings.ts';
import { createPlayerShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
import { createWorld } from '${process.cwd()}/src/client/simulation/world.ts';
import { Ship } from '${process.cwd()}/src/client/objects/ship.ts';
import { crotus } from '${process.cwd()}/src/specs/ships/crotus.ts';
import { controlShip } from '${process.cwd()}/src/client/objects/control-ship.ts';
import { HornDrill, SearchLight, CargoHatch, ShieldGenerator, ShieldGeneratorMd } from '${process.cwd()}/src/client/objects/modules/index.ts';
globalThis.window=new EventTarget();
initKeys();
const ship=createPlayerShip(createWorld());
const shieldGenerator=new ShieldGenerator();
ship.cargoContents.push(shieldGenerator);
ship.fit(shieldGenerator,ship.mounts.find(mount=>mount.fits.includes(ShieldGenerator)));
const keyEvent=(type,key,repeat=false)=>window.dispatchEvent(Object.assign(new Event(type),{key,repeat}));
const press=key=>keyEvent('keydown',key);
const release=key=>keyEvent('keyup',key);
for(const [Type,action,label] of [[HornDrill,'hornDrill','Horn Drill'],[SearchLight,'searchLight','Search Light'],[CargoHatch,'cargoHatch','Cargo Hatch'],[ShieldGenerator,'shieldGenerator','Shield Generator sm']]){
  assert.equal(Type.name,label,'module name uses terminology');
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
const mediumShip=new Ship({spec:crotus});
const medium=new ShieldGeneratorMd();
mediumShip.fit(medium,mediumShip.mounts.find(mount=>mount.fits.includes(ShieldGeneratorMd)));
press('s');
controlShip(mediumShip,playerInput,[]);
assert(mediumShip.moduleActive({module:ShieldGeneratorMd}),'the shared shield key activates medium');
release('s');
controlShip(mediumShip,playerInput,[]);
assert(mediumShip.moduleActive({module:ShieldGeneratorMd}),'medium stays active after release');
press('s');
controlShip(mediumShip,playerInput,[]);
assert(!mediumShip.moduleActive({module:ShieldGeneratorMd}),'the shared shield key deactivates medium');
release('s');
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
        load(id: string) {
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
