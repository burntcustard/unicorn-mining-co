import { autogunAmmo } from '../../src/specs/items';
import { exampleAmmo } from '../../src/specs/items/example-ammo';
import {
  moduleIds,
  moduleSpecList,
  type ModuleId,
} from '../../src/specs/modules';
import { moduleTypesById } from '../../src/client/objects/modules';
import { moduleSpecForSimulation } from '../../src/client/utilities/module-spec';
import { exampleModuleEntries } from './example-module-specs';

/**
 * Install synthetic data in this test process before constructing any objects.
 * Keep real behavior classes and wire slots so input, snapshots and rollback
 * exercise the same paths as gameplay without depending on playable tuning.
 */
export function installExampleModules() {
  Object.assign(autogunAmmo, exampleAmmo);

  for (const [key, example] of exampleModuleEntries) {
    const id = key as ModuleId;
    const original = moduleSpecList[moduleIds.indexOf(id)];
    const authored = { ...example, category: original.category };
    const runtime = moduleSpecForSimulation(authored);
    const Type = moduleTypesById.get(id)!;

    for (const key of Object.keys(original)) {
      if (!(key in authored)) {
        delete Type[key];
        delete (original as unknown as Record<string, unknown>)[key];
      }
    }

    Object.assign(original, authored);
    Object.assign(Type, runtime, { model: Type.createModel(runtime) });
  }
}
