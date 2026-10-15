import { exampleAmmo } from '../src/specs/items/example-ammo';
import { writeFileSync } from 'node:fs';
import { moduleSpecForSimulation } from '../src/client/utilities/module-spec';
import { exampleModuleEntries } from '../tests/support/example-module-specs';

writeFileSync(
  new URL('../tests/support/example-modules.json', import.meta.url),
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
  }) + '\n',
);
