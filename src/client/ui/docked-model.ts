import { Module } from '../objects/modules/module';
import { type Ship } from '../objects/ship';
import { type Mount } from '../types';
import { moduleTypesById } from '../objects/modules';

export const cargoMenuEntriesOf = (ship: any) => [
  ...ship.cargoContents
    .map((object: any) => object.item || object)
    .reduce(
      (types: Map<any, number>, item: any) =>
        types.set(item, (types.get(item) || 0) + 1),
      new Map(),
    ),
];

const moduleRows = new WeakMap<Ship, number[]>();

export const fitsOf = (ship: Ship, mount: Mount) => {
  const modulesById = new Map(
    ship.modules.map((module) => [module.id, module]),
  );
  const ids = (moduleRows.get(ship) || []).filter((id) => modulesById.has(id));

  modulesById.forEach((module, id) => {
    if (!ids.includes(id)) ids.push(id);
  });

  moduleRows.set(ship, ids);
  const rows = ids.map((id) => modulesById.get(id)!);

  return [...moduleTypesById.values()]
    .filter((type) => mount.fits.includes(type))
    .flatMap<Module | typeof Module>((type) => {
      const owned = rows.filter(
        (module) =>
          module.constructor === type &&
          (!module.mount || module.mount === mount),
      );

      return owned.length ? owned : [type];
    });
};
