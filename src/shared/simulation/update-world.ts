import { emptyPlayerInput, type PlayerInput } from '../protocol/input';
import { type PlayerId, type ShipEntity } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { resolveCollision } from './collisions';
import { inDockingBay, tryDock } from './docking';
import { scoop } from './scoop';
import { mine } from './mining';
import { controlShip } from './ship';
import { type SimulationWorld } from './world';

const dt = 1 / 60;

export const simulationStep = dt;

export const updateWorld = (
  world: SimulationWorld,
  inputs: Map<PlayerId, PlayerInput>,
): SimulationEvent[] => {
  const events: SimulationEvent[] = [];
  const ships: ShipEntity[] = [];

  [...world.players].forEach(([playerId, player]) => {
    const ship = world.entities.get(player.shipId);

    if (ship?.kind === 'ship')
      controlShip(ship, inputs.get(playerId) || emptyPlayerInput(), events);
  });

  [...world.entities.values()].forEach((entity) => {
    if (entity.kind === 'ship') ships.push(entity);
    if (entity.update(dt)) world.entities.delete(entity.id);
  });

  ships.forEach((ship) => mine(world, ship, events));
  ships.forEach((ship) => scoop(world, ship, events));

  const entities = [...world.entities.values()];

  entities.forEach((entity, index) => {
    entities.slice(index + 1).forEach((other) => {
      if (entity.kind === 'ship' && other.kind === 'station')
        tryDock(entity, other, events) ||
          (!entity.launching &&
            !inDockingBay(entity, other) &&
            resolveCollision(entity, other, events));
      else if (other.kind === 'ship' && entity.kind === 'station')
        tryDock(other, entity, events) ||
          (!other.launching &&
            !inDockingBay(other, entity) &&
            resolveCollision(other, entity, events));
      else if (
        (entity.kind === 'asteroid' && entity.decay) ||
        (other.kind === 'asteroid' && other.decay)
      )
        return;
      else resolveCollision(entity, other, events);
    });
  });

  world.tick++;
  return events;
};
