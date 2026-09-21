import { Vector } from '../../vector';
import {
  type Entity,
  type EntityId,
  type Player,
  type PlayerId,
} from '../protocol/entities';
import { type SimulationWorld } from './world';

export type SimulationWorldState = {
  entities: Map<EntityId, Entity>;
  nextEntityId: EntityId;
  players: Map<PlayerId, Player>;
  tick: number;
};

export const cloneEntity = ({ entity }: { entity: Entity }): Entity => {
  const copy = (values: object) =>
    Object.assign(
      Object.create(Object.getPrototypeOf(entity)),
      values,
    ) as Entity;
  const common = {
    id: entity.id,
    mass: entity.mass,
    position: Vector(entity.position.x, entity.position.y),
    radius: entity.radius,
    rotation: entity.rotation,
    spin: entity.spin,
    velocity: Vector(entity.velocity.x, entity.velocity.y),
  };

  if (entity.kind === 'asteroid')
    return copy({
      ...common,
      contents: [...entity.contents],
      decay: entity.decay,
      health: entity.health,
      kind: 'asteroid',
      maxHealth: entity.maxHealth,
      outline: entity.outline?.map(([x, y]) => [x, y]),
      points: entity.points,
      radiusEven: entity.radiusEven,
      resource: entity.resource,
      sections: entity.sections?.map((section) => ({
        ...section,
        contents: [...section.contents],
        outline: section.outline.map(([x, y]) => [x, y]),
      })),
    });
  if (entity.kind === 'station') return copy({ ...common, kind: 'station' });
  if (entity.kind === 'item')
    return copy({ ...common, kind: 'item', resource: entity.resource });
  return copy({
    ...common,
    cargo: entity.cargo && [...entity.cargo],
    dockedTo: entity.dockedTo,
    drill: entity.drill,
    hatch: entity.hatch,
    health: entity.health,
    kind: 'ship',
    launching: entity.launching,
    light: entity.light,
    maxSpeed: entity.maxSpeed,
    paint: entity.paint,
    playerId: entity.playerId,
    shield: entity.shield,
    thrust: entity.thrust,
    turn: entity.turn,
  });
};

export const captureWorld = ({
  world,
}: {
  world: SimulationWorld;
}): SimulationWorldState => ({
  entities: new Map(
    [...world.entities].map(([id, entity]) => [id, cloneEntity({ entity })]),
  ),
  nextEntityId: world.nextEntityId,
  players: new Map(
    [...world.players].map(([id, player]) => [id, { ...player }]),
  ),
  tick: world.tick,
});

export const restoreWorld = ({
  world,
  state,
}: {
  world: SimulationWorld;
  state: SimulationWorldState;
}) => {
  world.entities = new Map(
    [...state.entities].map(([id, entity]) => [id, cloneEntity({ entity })]),
  );
  world.nextEntityId = state.nextEntityId;
  world.players = new Map(
    [...state.players].map(([id, player]) => [id, { ...player }]),
  );
  world.tick = state.tick;
};
