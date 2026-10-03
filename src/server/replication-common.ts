import { Craft } from '../shared/craft/craft';
import { Module } from '../shared/modules/module';
import { type ModuleState } from '../shared/craft/module-state';
import { type AsteroidSegment } from '../shared/protocol/entities';
import { type SimulationWorld } from '../shared/simulation/world';
import { GameObject } from '../shared/game-object';
import { Asteroid } from '../shared/simulation/asteroid';
import { Station } from '../shared/craft/station';
import { ballisticReplicateEvery } from '../shared/settings';
import { isBallistic } from '../shared/collision/game-collisions';

type ModuleRecord = {
  modules: Module[];
  states: ModuleState[];
  indexes: Map<Module, number>;
  counts: number[];
};
const moduleRecords = new WeakMap<Craft, ModuleRecord>();

// Compare every module's segment activity with its last state in one pass.
const sameModuleSegments = (
  entity: Craft,
  { modules, states, indexes, counts }: ModuleRecord,
) => {
  if (indexes.size !== modules.length) return false;
  counts.fill(0);

  for (const segment of entity.segments) {
    const index = indexes.get(segment.module);

    if (index === undefined || segment.mount !== modules[index].mount) {
      continue;
    }
    const before = states[index].segments[counts[index]++];

    if (
      !before ||
      segment.active !== before.active ||
      segment.activationProgress !== before.activationProgress
    ) {
      return false;
    }
  }
  return counts.every(
    (count, index) => count === states[index].segments.length,
  );
};

export const readModules = (entity: Craft) => {
  const modules = entity.modules;

  if (!modules.length) return;
  const mounts = entity.mounts;
  const previous = moduleRecords.get(entity);

  if (
    previous &&
    modules.length === previous.modules.length &&
    modules.every((module, index) => {
      const state = previous.states[index];

      return (
        module === previous.modules[index] &&
        module.id === state.id &&
        mounts.indexOf(module.mount) === state.mount &&
        (module.mount ? module.mount.health : module.health) === state.health &&
        module.shades?.length === state.shades?.length &&
        !module.shades?.some(
          (shade: string, i: number) => shade !== state.shades?.[i],
        )
      );
    }) &&
    sameModuleSegments(entity, previous)
  ) {
    return previous.states;
  }
  const states = entity.moduleStates.map((state, index) => ({
    ...state,
    id: modules[index].id,
    shades: state.shades && [...state.shades],
  }));

  states.forEach((state) => {
    state.segments.forEach(Object.freeze);
    Object.freeze(state.segments);

    if (state.shades) Object.freeze(state.shades);
    Object.freeze(state);
  });
  Object.freeze(states);

  const indexes = new Map<Module, number>();

  modules.forEach((module, index) => indexes.set(module, index));
  moduleRecords.set(entity, {
    modules,
    states,
    indexes,
    counts: Array.from({ length: modules.length }, () => 0),
  });
  return states;
};

export const sameSegments = (a: AsteroidSegment[], b?: AsteroidSegment[]) =>
  b &&
  a.length === b.length &&
  a.every((segment, index) => {
    const previous = b[index];

    return (
      segment.health === previous.health &&
      segment.maxHealth === previous.maxHealth &&
      segment.mass === previous.mass &&
      segment.contents.length === previous.contents.length &&
      segment.contents.every((value, i) => value === previous.contents[i]) &&
      (segment.shapeOutline === previous.shapeOutline ||
        (segment.shapeOutline.length === previous.shapeOutline.length &&
          segment.shapeOutline.every(
            (point, i) =>
              point.length === previous.shapeOutline[i].length &&
              point.every((value, j) => value === previous.shapeOutline[i][j]),
          )))
    );
  });

export const copySegments = (segments: AsteroidSegment[]) =>
  segments.map((segment) => ({
    ...segment,
    contents: [...segment.contents],
    shapeOutline:
      Object.isFrozen(segment.shapeOutline) &&
      segment.shapeOutline.every(Object.isFrozen)
        ? segment.shapeOutline
        : segment.shapeOutline.map((point) => [...point]),
  }));

/*
 * One snapshot batch owns this list, read after simulation and discarded
 * before the next mutation. A flat scan rejects distant objects without
 * membership lookups; exact ranges and each receiver's hysteresis remain in
 * snapshot(). World insertion order is preserved for identical wire order.
 */
export class ReplicationView {
  private world: SimulationWorld;
  private snapshotList?: GameObject[];
  // Per entity: 1 for a station, 2 for free motion; and a sampling phase.
  kinds: number[] = [];
  phases: number[] = [];

  constructor(world: SimulationWorld) {
    this.world = world;
  }

  entities() {
    if (!this.snapshotList) {
      this.snapshotList = [...this.world.entities.values()];
      this.snapshotList.forEach((entity, index) => {
        const station = entity instanceof Station;

        this.kinds[index] =
          +station |
          (+((station || entity instanceof Asteroid) && isBallistic(entity)) <<
            1);
        this.phases[index] = entity.id % ballisticReplicateEvery;
      });
    }
    return this.snapshotList;
  }
}
