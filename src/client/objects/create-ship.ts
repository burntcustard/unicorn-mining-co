import { Ship } from './ship';
import { moduleTypesById } from './modules/index';
import { shipDefinitionsById } from '../../definitions/ships/index';
import { type SimulationWorld, entityId } from '../simulation/world';
import * as Vec from '../utilities/vector';
import { type PlayerId } from '../protocol/entities';

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
    shipType?: import('../../definitions/ships').ShipId;
  } = {},
): Ship => {
  const ship = new Ship({
    world,
    shipType,
    id,
    playerId,
    position,
    rotation,
    velocity,
    ...(shades && { shades }),
    credits: shipDefinitionsById.get(shipType)!.startingCredits,
  });

  shipDefinitionsById
    .get(shipType)!
    .startingModules.forEach((id) =>
      ship.fit(new (moduleTypesById.get(id)!)()),
    );
  return ship;
};
