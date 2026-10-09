import { autogunAmmunition } from '../../specs/items';
import { Module } from '../objects/modules/module';
import { type Ship } from '../objects/ship';
import { type Mount } from '../types';
import { moduleTypesById } from '../objects/modules';
import { player } from '../player';

export const cargoMenuEntriesOf = (ship: any) => [
  ...ship.cargoContents
    .map((object: any) => object.item || object)
    .reduce(
      (types: Map<any, number>, item: any) =>
        types.set(item, (types.get(item) || 0) + 1),
      new Map(),
    ),
  [autogunAmmunition, 0],
];

// Ore of a kind stacks into one row, but two module instances never do, so a
// count is only worth showing when there is more than one
export const cargoMenuEntryName = ([item, count]: any[]) => {
  const name = item.name?.toUpperCase() ?? item.label;

  if (count === 0) return `BUY ${name} $${item.price}`;

  return count > 1 ? `${name} *${count}` : name;
};

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

// Equip and remove move a module between cargo and a mount; buy and sell
// change ownership.
export const moduleActionsOf = (mount: any, module: any) => {
  const equipped = mount.module === module;
  const owned = module instanceof Module;

  return equipped
    ? mount.health < (module.health || module.healthActivated)
      ? ['FIX', 'REMOVE']
      : ['REMOVE']
    : owned
      ? ['EQUIP', 'SELL']
      : ['BUY'];
};

export type DockedSelection = { section: number; itemKey: string };

export const dockedModel = (ship: Ship, selection: DockedSelection) => {
  const hull = selection.section === -1;
  const cargo = selection.section === -2;
  const mount = ship.mounts[selection.section];

  const rows = hull
    ? []
    : cargo
      ? cargoMenuEntriesOf(ship).map(([item, count]: any[]) => ({
          key: count === 0 ? 'ammo-shop' : `cargo-${item.id ?? item.resource}`,
          label: cargoMenuEntryName([item, count]),
          item,
          count,
        }))
      : mount
        ? fitsOf(ship, mount).map((item) => ({
            key:
              item instanceof Module
                ? `owned-${item.id}`
                : `shop-${item.definitionId}`,
            label: `${item.name.toUpperCase()}${mount.module === item ? ' / FITTED' : ''}`,
            item,
            count: 1,
          }))
        : [];

  const selected = rows.find((row) => row.key === selection.itemKey) || rows[0];
  const item = hull ? ship : selected?.item;
  const repairCost = hull
    ? ship.repairCost()
    : mount?.module === item
      ? ship.repairCost(mount)
      : 0;
  const actions: string[] = !item
    ? []
    : hull
      ? repairCost
        ? ['FIX']
        : []
      : cargo
        ? selected.count === 0
          ? ['BUY']
          : ['SELL']
        : moduleActionsOf(mount, item);
  const canPaint = hull || item instanceof Module;
  const maxHealth = hull
    ? ship.hullMaxHealth
    : item?.health || item?.healthActivated || 0;
  const health = hull
    ? ship.hullHealthTotal
    : mount?.module === item
      ? mount.health
      : maxHealth;

  return {
    rows,
    selected,
    item,
    mount,
    hull,
    cargo,
    repairCost,
    actions,
    canPaint,
    health,
    maxHealth,
    disabled: (action: string) =>
      !item ||
      (action === 'BUY' &&
        (player.credits < item.price ||
          ship.cargoContents.length >= ship.cargoSpace)) ||
      (action === 'FIX' && player.credits < repairCost) ||
      (action === 'REMOVE' && ship.cargoContents.length >= ship.cargoSpace),
  };
};
