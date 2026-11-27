import { exampleAmmo } from '../src/specs/items/example-ammo';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { moduleSpecForSimulation } from '../src/client/utilities/module-spec';
import { exampleModuleEntries } from '../tests/support/example-module-specs';

const path = new URL('../tests/support/example-modules.json', import.meta.url);

const contents =
  JSON.stringify({
    itemSpecs: { autogunAmmo: exampleAmmo },
    moduleSpecs: Object.fromEntries(
      exampleModuleEntries.map(([id, spec]) => [
        id,
        {
          ...moduleSpecForSimulation(spec),
          ammo: 'ammo' in spec ? spec.ammo?.resource : undefined,
        },
      ]),
    ),
  }) + '\n';

if (!existsSync(path) || readFileSync(path, 'utf8') !== contents) {
  writeFileSync(path, contents);
}
