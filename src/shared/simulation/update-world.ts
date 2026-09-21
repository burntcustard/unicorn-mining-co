import { type PlayerId } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { emptyPlayerInput, type PlayerInput } from '../protocol/input';
import { detectCollisions, resolve } from './collisions';
import { dock } from './docking';
import { mine } from './mining';
import { type Contact } from './physics';
import { controlShip } from '../craft/control-ship';
import { scoop } from './scoop';
import { type SimulationWorld } from './world';
import { Ship } from '../craft/ship';
import { updateEntities } from './update-tier';

/** Advance every entity through the shared gameplay and compound-SAT pipeline. */
export const updateWorld = (
  world: SimulationWorld,
  inputs: Map<PlayerId, PlayerInput>,
): SimulationEvent[] => {
  const events: SimulationEvent[] = [];
  world.entities.forEach((entity) => {
    if (entity instanceof Ship)
      entity.segments.forEach((segment) => {
        segment.biting = false;
      });
  });

  world.players.forEach((player, playerId) => {
    const ship = world.entities.get(player.shipId);

    if (ship instanceof Ship)
      controlShip(ship, inputs.get(playerId) || emptyPlayerInput(), events);
  });

  const contacts: Contact[] = [];
  updateEntities({
    world,
    afterUpdate: ({ entities, substep }) => {
      const found = detectCollisions({ entities });
      contacts.push(...found);
      resolve({ contacts: found, events: substep ? undefined : events });
    },
  });

  dock({ contacts, events });
  scoop({ contacts, events, world });
  mine({ contacts, events, world });
  world.tick++;
  return events;
};
