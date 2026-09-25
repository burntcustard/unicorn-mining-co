import { Ship } from './ship';
import { Mustang } from './ships/mustang';
import { ThrusterDualMd, CargoHatch, HornDrill, SearchLight } from '../modules';
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
    playerId,
    position,
    rotation,
    velocity,
    ...(shades && { shades }),
    credits: 500,
  });

  [ThrusterDualMd, CargoHatch, CargoHatch, HornDrill, SearchLight].forEach(
    (Type) => ship.fit(new Type()),
  );
  return ship;
};
