import { Projectile } from '../objects/projectile';
import { type PlayerId } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { emptyPlayerInput, type PlayerInput } from '../protocol/input';
import { type InputFrame } from '../protocol/input-frame';
import { GameCollisions } from '../collision/game-collisions';
import { controlShip } from '../objects/control-ship';
import { type SimulationWorld } from './world';
import { Ship } from '../objects/ship';
import { Craft } from '../objects/craft';
import { type GameObject } from '../objects/game-object';
import { type Contact } from '../collision/types';
import { simulationStep } from '../../specs/simulation';
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
    if (entity instanceof Projectile) entity.captureSweep();

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

  collisions.capturePoses(world.entities);

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

  world.entities.forEach((entity) => {
    if (entity instanceof Projectile) entity.resolveHits(events, world, dt);
  });

  const contactsByOwner = new Map<GameObject, Contact[]>();

  for (let index = 0; index < contacts.length; index++) {
    const contact = contacts[index];
    const colliderOwner = contact.collider.owner;
    const otherOwner = contact.other.owner;
    let ownContacts = contactsByOwner.get(colliderOwner);

    if (!ownContacts) {
      ownContacts = [];
      contactsByOwner.set(colliderOwner, ownContacts);
    }

    ownContacts.push(contact);
    ownContacts = contactsByOwner.get(otherOwner);

    if (!ownContacts) {
      ownContacts = [];
      contactsByOwner.set(otherOwner, ownContacts);
    }

    ownContacts.push(contact);
  }

  contactsByOwner.forEach((ownContacts, entity) => {
    if (entity instanceof Craft) {
      entity.handleDockingContacts({ contacts: ownContacts, events });
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
