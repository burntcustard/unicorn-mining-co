import { Ship } from './ship';
import { Mustang } from './ships/mustang';
import { moduleTypesById } from '../modules';
import { shipSpecifications } from '../specification/ships';
import { type SimulationWorld, entityId } from '../simulation/world';
import * as Vec from '../vector';
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
  }: {
    id?: number;
    playerId?: PlayerId;
    position?: Vec.Value;
    rotation?: number;
    velocity?: Vec.Value;
    shades?: readonly string[];
  } = {},
): Ship => {
  const ship = new Mustang({
    world,
    id,
    playerId,
    position,
    rotation,
    velocity,
    ...(shades && { shades }),
    credits: shipSpecifications.mustang.startingCredits,
  });

  shipSpecifications.mustang.startingModules.forEach((id) =>
    ship.fit(new (moduleTypesById.get(id)!)()),
  );
  return ship;
};
