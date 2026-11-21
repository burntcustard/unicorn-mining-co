import { shipSpecsById, type ShipId } from '../ships';
import { moduleIds, moduleSpecList } from '../modules';
import { type ShipOffer } from './types';
import { type ItemId } from '../items';

export const corralInitialCargoContents = [
  { item: 'autogunAmmo', count: 300 },
] satisfies { item: ItemId; count: number }[];

const stationShipIds: readonly ShipId[] = [
  'mustang',
  'arrow',
  'crotus',
  'courser',
  'moth',
  'finch',
  'kestrel',
  'excel8',
  'excel15',
];

export const corralShipOffers: ShipOffer[] = stationShipIds.map((ship) => {
  const spec = shipSpecsById.get(ship)!;

  return {
    ship,
    price:
      spec.price +
      spec.initialLoadout.reduce(
        (sum, entry) =>
          sum + (moduleSpecList[moduleIds.indexOf(entry.module)].price ?? 0),
        0,
      ),
  };
});
