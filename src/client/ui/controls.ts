import { type Module } from '../objects/modules/module';
import { type Ship } from '../objects/ship';
import { moduleControls } from '../objects/control-ship';
import { moduleBinding } from '../input/keybindings';
import { Item } from '../objects/item';

/**
 * One row per fitted toggle-controlled module type, in mount order. Resolve
 * binding modes here, alongside gameplay tags, before presenting them in DOM UI.
 */
export const moduleRowsOf = (ship: Ship) => {
  const types: (typeof Module)[] = [];

  ship.mounts.forEach(({ module }) => {
    if (!module) return;
    const Type = module.constructor as typeof Module;

    if (
      !types.includes(Type) &&
      moduleControls.some(
        ({ Type: control, input }) =>
          module instanceof control && moduleBinding(input).mode === 'toggle',
      )
    ) {
      types.push(Type);
    }
  });

  return types.map((Type) => {
    const action = moduleControls.find(
      ({ Type: control }) =>
        Type === control || Type.prototype instanceof control,
    )!.input;
    const ammo = Type.ammo;
    const rounds = ammo
      ? ship.cargoContents.reduce(
          (sum, item) =>
            item instanceof Item && item.resource === ammo.resource
              ? sum + (item.rounds || 0)
              : sum,
          0,
        )
      : undefined;

    return {
      Type,
      binding: moduleBinding(action),
      name: rounds === undefined ? Type.name : `${Type.name} (${rounds})`,
    };
  });
};
