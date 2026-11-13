import assert from 'node:assert/strict';
import { createPlayerShip } from '../../src/client/objects/create-ship';
import {
  moduleTypes,
  moduleTypesById,
  PowerPlant,
} from '../../src/client/objects/modules';
import { Ship } from '../../src/client/objects/ship';
import { createWorld } from '../../src/client/simulation/world';
import {
  moduleSpecs,
  powerPlantIds,
  stationModuleIds,
} from '../../src/specs/modules';
import type { ModuleSpec } from '../../src/specs/modules/types';
import { shipSpecsById } from '../../src/specs/ships';

const plantSpec = (id: (typeof powerPlantIds)[number]) =>
  moduleSpecs[id] as Extract<ModuleSpec, { behavior: 'powerPlant' }>;

assert.equal(powerPlantIds.length, 16);
assert.equal(new Set(powerPlantIds).size, 16);

for (let size = 0; size < 4; size++) {
  const [a, h, v, l] = powerPlantIds
    .slice(size * 4, size * 4 + 4)
    .map(plantSpec);

  assert(
    a.powerGenerated > h.powerGenerated &&
      h.powerGenerated > l.powerGenerated &&
      l.powerGenerated > v.powerGenerated,
  );
  assert(l.weight < a.weight && a.weight < v.weight && v.weight < h.weight);
  assert(a.price > l.price && l.price > h.price && h.price > v.price);

  if (size) {
    for (let rating = 0; rating < 4; rating++) {
      const previous = plantSpec(powerPlantIds[(size - 1) * 4 + rating]);
      const current = plantSpec(powerPlantIds[size * 4 + rating]);

      assert(
        current.powerGenerated > previous.powerGenerated &&
          current.weight > previous.weight,
      );
    }
  }
}

const shipSizes = {
  arrow: 2,
  courser: 1,
  crotus: 2,
  finch: 1,
  kestrel: 3,
  moth: 4,
  mustang: 2,
} as const;

for (const shipType of shipSpecsById.keys()) {
  const size = shipSizes[shipType];

  for (const id of powerPlantIds) {
    const ship = createPlayerShip(createWorld(), { shipType });
    const mount = ship.mounts.find(
      (entry) => entry.module instanceof PowerPlant,
    )!;
    const mountIndex = ship.mounts.indexOf(mount);
    const Type = moduleTypesById.get(id)!;
    const compatible = id.startsWith(`powerPlant${size}`);

    assert(mount.module);
    assert.equal(
      (mount.module.constructor as typeof PowerPlant).definitionId,
      `powerPlant${size}V`,
    );
    assert(stationModuleIds.includes(id));
    assert.equal(mount.fits.includes(Type), compatible, `${shipType}: ${id}`);

    ship.fit(0, mount);
    const player = { credits: 100000 };
    const purchase = ship.applyDockAction(
      { action: 'buy', module: moduleTypes.indexOf(Type), mount: mountIndex },
      player,
    );

    assert.equal(Boolean(purchase), compatible, `${shipType}: purchase ${id}`);

    if (!compatible) {
      assert.equal(player.credits, 100000);
      const cargoPurchase = ship.applyDockAction(
        { action: 'buy', module: moduleTypes.indexOf(Type) },
        player,
      );
      const cargoPlant = ship.cargoContents.find(
        (object) => object instanceof Type,
      );

      assert(cargoPurchase && cargoPlant);
      assert.equal(
        ship.applyDockAction(
          { action: 'equip', moduleId: cargoPlant.id, mount: mountIndex },
          player,
        ),
        undefined,
        `${shipType}: equip incompatible ${id}`,
      );
      assert(ship.cargoContents.includes(cargoPlant));
      continue;
    }

    assert(mount.module instanceof PowerPlant);
    const restored = new Ship({ shipType });

    restored.moduleStates = ship.moduleStates;
    const restoredPlant = restored.mounts[mountIndex].module;

    assert(restoredPlant);
    assert.equal(
      (restoredPlant.constructor as typeof PowerPlant).definitionId,
      id,
    );
    assert.equal(mount.module.weight, moduleSpecs[id].weight);
  }
}
