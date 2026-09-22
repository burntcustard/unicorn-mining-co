import { type PlayerId } from '../protocol/entities';
import { type SimulationEvent } from '../protocol/events';
import { emptyPlayerInput, type PlayerInput } from '../protocol/input';
import { type InputFrame } from '../protocol/input-frame';
import { GamePhysics } from '../physics/game-physics';
import { Vector } from '../vector';
import { dock } from './docking';
import { mine } from './mining';
import { controlShip } from '../craft/control-ship';
import { scoop } from './scoop';
import { type SimulationWorld } from './world';
import { Ship } from '../craft/ship';
import { updateEntities, simulationStep } from './update-tier';

const physicsWorlds = new WeakMap<SimulationWorld, GamePhysics>();

/*
 * Preserve gameplay movement, then sweep it through shared rigid-body physics.
 * The resulting physical and sensor contacts drive docking, scooping and mining.
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
    if (entity instanceof Ship)
      entity.segments.forEach((segment) => {
        segment.biting = false;
      });
  });

  world.players.forEach((player, playerId) => {
    const ship = world.entities.get(player.shipId);

    const input = inputs.get(playerId) || emptyPlayerInput();
    if (ship instanceof Ship)
      controlShip(ship, 'changes' in input ? input.input : input, events);
  });

  let physics = physicsWorlds.get(world);
  if (!physics) {
    physics = new GamePhysics();
    physicsWorlds.set(world, physics);
  }
  const previous = new Map(
    [...world.entities].map(([id, entity]) => [
      id,
      {
        position: entity.position.add(Vector()),
        rotation: entity.rotation,
      },
    ]),
  );
  updateEntities({ world, inputs, events, dt });
  const contacts = physics.step({
    entities: [...world.entities.values()],
    previous,
    dt,
    events,
  });

  dock({ contacts, events });
  scoop({ contacts, events, world });
  mine({ contacts, events, world });
  world.tick++;
  return events;
};
