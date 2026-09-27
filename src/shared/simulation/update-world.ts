import * as Vec from '../vector';
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

const collisionWorlds = new WeakMap<
  SimulationWorld,
  {
    collisions: GameCollisions;
    previous: Map<number, { position: Vec.Value; rotation: number }>;
  }
>();

/*
 * Preserve gameplay movement, then sweep it through the shared collision system.
 * Contacts drive docking, scooping and drilling; physical contacts also resolve motion.
 */
export const updateWorld = ({
  world,
  inputs,
  dt = simulationStep,
}: {
  world: SimulationWorld;
  inputs: Map<PlayerId, PlayerInput | InputFrame>;
  dt?: number;
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

  let state = collisionWorlds.get(world);

  if (!state) {
    state = { collisions: new GameCollisions(), previous: new Map() };
    collisionWorlds.set(world, state);
  }
  const { collisions, previous } = state;

  previous.forEach((_, id) => {
    if (!world.entities.has(id)) previous.delete(id);
  });
  world.entities.forEach((entity, id) => {
    const pose = previous.get(id);

    if (pose) {
      Vec.set(pose.position, entity.position);
      pose.rotation = entity.rotation;
    } else {
      previous.set(id, {
        position: Vec.clone(entity.position),
        rotation: entity.rotation,
      });
    }
  });

  updateEntities({ world, inputs, events, dt });
  const contacts = collisions.step({
    entities: [...world.entities.values()],
    previous,
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
  world.tick++;
  return events;
};
