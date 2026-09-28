import { type PlayerId } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { emptyPlayerInput, type PlayerInput } from '../protocol/input';
import { type InputFrame } from '../protocol/input-frame';
import { GameCollisions } from '../collision/game-collisions';
import { controlShip } from '../craft/control-ship';
import { type SimulationWorld } from './world';
import { Ship } from '../craft/ship';
import { Station } from '../craft/station';
import { type GameObject } from '../game-object';
import { type Contact } from '../collision/types';
import { simulationStep } from '../settings';
import { updateEntities } from './update-tier';

const collisionWorlds = new WeakMap<SimulationWorld, GameCollisions>();

/*
 * Preserve gameplay movement, then sweep it through the shared collision system.
 * Contacts drive docking, scooping and drilling; physical contacts also resolve motion.
 */
export const updateWorld = ({
  world,
  inputs,
  dt = simulationStep,
  ticks = 1,
}: {
  world: SimulationWorld;
  inputs: Map<PlayerId, PlayerInput | InputFrame>;
  dt?: number;
  ticks?: number;
}): SimulationEvent[] => {
  const events: SimulationEvent[] = [];

  world.entities.forEach((entity) => {
    if (entity instanceof Ship) {
      entity.segments.forEach((segment) => {
        segment.biting = false;
      });
    }
  });

  world.players.forEach((player, playerId) => {
    const ship = world.entities.get(player.shipId);

    const input = inputs.get(playerId) || emptyPlayerInput();

    if (ship instanceof Ship) {
      controlShip(ship, 'changes' in input ? input.input : input, events);
    }
  });

  let collisions = collisionWorlds.get(world);

  if (!collisions) {
    collisions = new GameCollisions();
    collisionWorlds.set(world, collisions);
  }
  collisions.capturePoses(world.entities.values());

  // Integrate movement and timed input edges at the usual cadence, while an
  // overdue server update shares one collision sweep across the elapsed ticks.
  for (let index = 0; index < ticks; index++) {
    updateEntities({
      world,
      inputs,
      events,
      dt: dt / ticks,
      tick: world.tick + index,
      inputOffset: (index * dt) / ticks,
    });
  }
  const contacts = collisions.step({
    entities: world.entities,
    dt,
    events,
  });

  const contactsByOwner = new Map<GameObject, Contact[]>();

  contacts.forEach((contact) => {
    const owners = [contact.collider.owner, contact.other.owner];

    owners.forEach((owner) => {
      const ownContacts = contactsByOwner.get(owner) || [];

      ownContacts.push(contact);
      contactsByOwner.set(owner, ownContacts);
    });
  });
  contactsByOwner.forEach((ownContacts, entity) => {
    if (entity instanceof Station) {
      entity.handleContacts({ contacts: ownContacts, events });
    }
  });
  contactsByOwner.forEach((ownContacts, entity) => {
    if (entity instanceof Ship) {
      entity.handleContacts({ contacts: ownContacts, events, world, dt });
    }
  });
  // Contacts and docking can move entities after their own update.
  world.entities.forEach((entity) => entity.roundMotion());
  world.tick += ticks;
  return events;
};
