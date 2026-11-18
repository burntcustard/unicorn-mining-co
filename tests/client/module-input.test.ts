/* global Buffer, process */
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins.ts';
import { testBuildPlugin } from '../support/build-plugin';
import { stripIfdef } from '../../plugins/replace-pre-terser.ts';

const scenario = `
import { installExampleModules } from '${process.cwd()}/tests/support/example-modules.ts';
installExampleModules();
import assert from 'node:assert/strict';
import { initKeys, playerInput } from '${process.cwd()}/src/client/input/input.ts';
import { moduleBinding, defaultKeybindings } from '${process.cwd()}/src/client/input/keybindings.ts';
import { createPlayerShip } from '${process.cwd()}/src/client/objects/create-ship.ts';
import { createBoosterShip } from '${process.cwd()}/tests/support/booster-ship.ts';
import { createWorld } from '${process.cwd()}/src/client/simulation/world.ts';
import { Ship } from '${process.cwd()}/src/client/objects/ship.ts';
import { crotus } from '${process.cwd()}/src/specs/ships/crotus.ts';
import { controlShip } from '${process.cwd()}/src/client/objects/control-ship.ts';
import { HornDrill, SearchLight, CargoHatch, ShieldGenerator, ShieldGeneratorMd, FlightMode, ThrustBooster } from '${process.cwd()}/src/client/objects/modules/index.ts';
import { moduleRowsOf } from '${process.cwd()}/src/client/ui/controls.ts';
globalThis.window=new EventTarget();
const inputChanges=[];
initKeys({onChange:input=>inputChanges.push(input)});
defaultKeybindings.cargoRelease.keys=['j'];
const ship=createPlayerShip(createWorld());
const shieldGenerator=new ShieldGenerator();
ship.cargoContents.push(shieldGenerator);
ship.fit(shieldGenerator,ship.mounts.find(mount=>mount.fits.includes(ShieldGenerator)));
const keyEvent=(type,key,repeat=false)=>window.dispatchEvent(Object.assign(new Event(type),{key,repeat}));
const press=key=>keyEvent('keydown',key);
const release=key=>keyEvent('keyup',key);
for(const [Type,action,label] of [[HornDrill,'hornDrill','Horn Drill'],[SearchLight,'searchLight','Search Light'],[CargoHatch,'cargoHatch','Cargo Hatch'],[ShieldGenerator,'shieldGenerator','Shield Generator sm']]){
  const binding=moduleBinding(action);
  assert(Array.isArray(binding.keys) && binding.mode==='toggle');
  const key=binding.keys[0].toUpperCase();
  press(key);
  controlShip(ship,playerInput,[]);
  assert(ship.moduleActive({module:Type}),key+' immediately activates on its dedicated key');
  release(key);
  controlShip(ship,playerInput,[]);
  assert(ship.moduleActive({module:Type}),key+' stays toggled after release');
  keyEvent('keydown',key,true);
  controlShip(ship,playerInput,[]);
  assert(ship.moduleActive({module:Type}),'key repeat does not retoggle');
  press(key);
  controlShip(ship,playerInput,[]);
  assert(!ship.moduleActive({module:Type}),key+' immediately toggles off on its next press');
  release(key.toLowerCase());
  controlShip(ship,playerInput,[]);
  assert(!ship.moduleActive({module:Type}),key+' remains off after release');
  binding.mode='hold';
  press(key);
  controlShip(ship,playerInput,[]);
  assert(ship.moduleActive({module:Type}),'Hold immediately activates '+label);
  release(key);
  controlShip(ship,playerInput,[]);
  assert(!ship.moduleActive({module:Type}),'releasing Hold deactivates '+label);
  press(key);
  controlShip(ship,playerInput,[]);
  assert(ship.moduleActive({module:Type}),'a new Hold activates '+label+' again');
  release(key);
  controlShip(ship,playerInput,[]);
  assert(!ship.moduleActive({module:Type}),'each release deactivates '+label);
  binding.mode='toggle';
}
const mediumShip=new Ship({spec:crotus});
const medium=new ShieldGeneratorMd();
mediumShip.fit(medium,mediumShip.mounts.find(mount=>mount.fits.includes(ShieldGeneratorMd)));
press('s');
controlShip(mediumShip,playerInput,[]);
assert(mediumShip.moduleActive({module:ShieldGeneratorMd}),'the shield key immediately activates medium shields');
release('s');
controlShip(mediumShip,playerInput,[]);
assert(mediumShip.moduleActive({module:ShieldGeneratorMd}),'medium stays active after release');
press('s');
controlShip(mediumShip,playerInput,[]);
assert(!mediumShip.moduleActive({module:ShieldGeneratorMd}),'the next shield press immediately deactivates medium shields');
release('s');
controlShip(mediumShip,playerInput,[]);
assert(!mediumShip.moduleActive({module:ShieldGeneratorMd}),'medium stays off after release');
press('f');
controlShip(ship,playerInput,[]);
assert(!ship.moduleActive({module:SearchLight}),'there are no hidden module key aliases');
release('f');

const flightShip=createPlayerShip(createWorld(),{shipType:'crescent',playerId:7});
// Exercise player controls without changing the production NPC-only ship spec.
assert(flightShip.mounts.some(mount=>mount.module instanceof FlightMode),'Crescent starts with its fitted flight controller');
const flightBinding=moduleBinding('flightMode');
const flightRows=moduleRowsOf(flightShip).filter(row=>row.Type===FlightMode);
assert.equal(flightRows.length,1,'the fitted flight controller has one HUD row');
assert.equal(flightRows[0].name,'Flight Mode');
assert.equal(flightRows[0].binding,flightBinding,'HUD and keyboard use the same binding');
assert(!moduleRowsOf(ship).some(row=>row.Type===FlightMode),'ships without a controller have no flight-mode HUD row');
assert.deepEqual(flightBinding.keys,['c']);
assert.equal(flightBinding.mode,'toggle');
const flightEvents=[];
press('C');
controlShip(flightShip,playerInput,flightEvents);
assert.equal(playerInput.flightMode,true);
assert.equal(inputChanges.at(-1).flightMode,true,'the new control produces an input transition immediately');
assert(flightShip.moduleActive({module:FlightMode}),'C activates the fitted controller');
assert.deepEqual(flightEvents,[{type:'moduleChanged',module:'flightMode',active:true,playerId:7}]);
const flightChangeCount=inputChanges.length;
release('c');
controlShip(flightShip,playerInput,flightEvents);
keyEvent('keydown','C',true);
controlShip(flightShip,playerInput,flightEvents);
assert(flightShip.moduleActive({module:FlightMode}),'release and key repeat preserve the toggle');
assert.equal(inputChanges.length,flightChangeCount,'unchanged toggles do not resend input');
assert.equal(flightEvents.length,1,'release and repeat do not duplicate module events');
press('c');
controlShip(flightShip,playerInput,flightEvents);
assert(!flightShip.moduleActive({module:FlightMode}),'the next C press restores combat configuration');
assert.deepEqual(flightEvents.at(-1),{type:'moduleChanged',module:'flightMode',active:false,playerId:7});
release('C');
controlShip(flightShip,playerInput,flightEvents);
assert(!flightShip.moduleActive({module:FlightMode}));

flightBinding.mode='hold';
assert.equal(moduleRowsOf(flightShip).find(row=>row.Type===FlightMode).binding.mode,'hold','the HUD follows the configured mode');
press('C');
controlShip(flightShip,playerInput,[]);
assert(flightShip.moduleActive({module:FlightMode}),'Hold activates flight mode while C is down');
release('c');
controlShip(flightShip,playerInput,[]);
assert(!flightShip.moduleActive({module:FlightMode}),'releasing Hold deactivates flight mode');
press('c');
controlShip(flightShip,playerInput,[]);
window.dispatchEvent(new Event('blur'));
controlShip(flightShip,playerInput,[]);
assert(!flightShip.moduleActive({module:FlightMode}),'losing focus releases held flight mode');
flightBinding.keys=['g'];
press('c');
controlShip(flightShip,playerInput,[]);
assert(!flightShip.moduleActive({module:FlightMode}),'rebinding removes the old flight-mode key');
release('c');
press('G');
controlShip(flightShip,playerInput,[]);
assert(flightShip.moduleActive({module:FlightMode}),'the rebound key controls the same fitted controller');
release('g');
controlShip(flightShip,playerInput,[]);
assert(!flightShip.moduleActive({module:FlightMode}));
flightBinding.keys=['c'];
flightBinding.mode='toggle';

const boostShip=createBoosterShip();
const boostBinding=moduleBinding('thrustBoost');
const boostRows=moduleRowsOf(boostShip).filter(row=>row.Type===ThrustBooster);
assert.equal(boostRows.length,1,'a pair of fitted thrust boosters shares one HUD action');
assert.equal(boostRows[0].binding,boostBinding,'HUD and keyboard share the rebindable boost shortcut');
assert.deepEqual(boostBinding.keys,['Shift']);
assert.equal(boostBinding.mode,'hold');
const boosts=boostShip.modules.filter(module=>module instanceof ThrustBooster);
assert.equal(boosts.length,2);
const boostEvents=[];
press('Shift');
controlShip(boostShip,playerInput,boostEvents);
assert(boostShip.moduleActive({module:ThrustBooster}),'Shift starts both fitted boosters');
const debts=boosts.map(module=>module.chargeCooldown);
assert(debts.every(debt=>debt>0),'activation consumes a charge');
release('Shift');
controlShip(boostShip,playerInput,boostEvents);
assert(boostShip.moduleActive({module:ThrustBooster}),'release does not cancel the timed boost');
assert.deepEqual(boosts.map(module=>module.chargeCooldown),debts,'generic module control leaves charge state unchanged');
keyEvent('keydown','Shift',true);
controlShip(boostShip,playerInput,boostEvents);
assert.deepEqual(boosts.map(module=>module.chargeCooldown),debts,'repeat does not consume extra charges');
assert.deepEqual(boostEvents,[],'boost is a timed action rather than a module toggle event');
console.log('Module toggles, Hold controls and the flight-mode HUD binding passed');`;

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
      ...(production ? [testBuildPlugin()] : []),
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
