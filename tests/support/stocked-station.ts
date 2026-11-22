import { Item } from '../../src/client/objects/item';
import { Station } from '../../src/client/objects/station';
import {
  entityId,
  type SimulationWorld,
} from '../../src/client/simulation/world';
import { itemSpecs } from '../../src/specs/items';
import { corralInitialCargoContents } from '../../src/specs/stations/market';

/**
 * Give local simulation fixtures the same starting stock as the server.
 */
export const createStockedStation = (
  world: SimulationWorld,
  options?: ConstructorParameters<typeof Station>[0],
) => {
  const station = new Station({ ...options, world });

  world.nextEntityId = Math.max(world.nextEntityId, station.id + 1);
  station.cargoContents = corralInitialCargoContents.flatMap(
    ({ item, count }) =>
      Array.from(
        { length: count },
        () => new Item(itemSpecs[item], { world, id: entityId(world) }),
      ),
  );
  return station;
};
