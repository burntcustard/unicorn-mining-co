import { Ship } from './ship';
import { Mustang } from './ships/mustang';
import { fitStarterModules } from './fit-starter-modules';
import { type SimulationWorld, entityId } from '../simulation/world';
import { Vector, type Vector as VectorValue } from '../vector';
import { type PlayerId } from '../protocol/entities';

export const createShip = (
  world: SimulationWorld,
  {
    id = entityId(world),
    playerId,
    position = Vector(),
    rotation = 0,
    velocity = Vector(),
    shades,
  }: {
    id?: number;
    playerId?: PlayerId;
    position?: VectorValue;
    rotation?: number;
    velocity?: VectorValue;
    shades?: readonly string[];
  } = {},
): Ship => {
  const ship = new Mustang({
    world,
    id,
    mass: 9,
    playerId,
    position,
    radius: 40,
    rotation,
    velocity,
    ...(shades && { shades }),
  });
  fitStarterModules(ship);
  return ship;
};
