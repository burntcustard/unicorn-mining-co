import { Ship } from './ship';
import { moduleTypesById } from './modules/index';
import { type SimulationWorld, entityId } from '../simulation/world';
import * as Vec from '../utilities/vector';
import { type PlayerId } from '../protocol/entities';
import { shipSpecsById } from '../../specs/ships';

export const createShip = (
  world: SimulationWorld,
  {
    id = entityId(world),
    playerId,
    position = Vec.create(),
    rotation = 0,
    velocity = Vec.create(),
    shades,
    shipType = 'mustang',
  }: {
    id?: number;
    playerId?: PlayerId;
    position?: Vec.Value;
    rotation?: number;
    velocity?: Vec.Value;
    shades?: readonly string[];
    shipType?: import('../../specs/ships').ShipId;
  } = {},
): Ship => {
  return new Ship({
    world,
    shipType,
    id,
    playerId,
    position,
    rotation,
    velocity,
    ...(shades && { shades }),
  });
};

export const createPlayerShip = (
  world: SimulationWorld,
  properties: Parameters<typeof createShip>[1] = {},
): Ship => {
  const ship = createShip(world, properties);

  shipSpecsById
    .get(properties.shipType ?? 'mustang')!
    .initialLoadout.forEach(({ mount, module }) =>
      ship.fit(new (moduleTypesById.get(module)!)(), ship.mounts[mount]),
    );
  return ship;
};
