import { Vector, type Vector as VectorValue } from '../shared/vector';
import { createAsteroid } from '../shared/simulation/asteroid';
import { createShip } from '../shared/craft/create-ship';
import { createItem } from '../shared/items/create-item';
import { createStation } from '../shared/craft/create-station';
import {
  RegionManager as ProceduralRegionManager,
  worldRanges,
} from '../shared/simulation/region-manager';
import { addEntity, type SimulationWorld } from '../shared/simulation/world';
import {
  type RegionalView,
  type WorldRanges,
} from '../shared/protocol/regions';
import { type GameObject } from '../shared/game-object';
import { Station } from '../shared/craft/station';

const serverRanges: WorldRanges = {
  ...worldRanges,
  asteroid: 2500,
  stationPhysics: 11000,
  wreck: 2500,
};

export class RegionManager {
  private managed = new Set<number>();
  private sleeping = new Map<number, GameObject>();
  private regions: ProceduralRegionManager;

  constructor({ worldSeed }: { worldSeed: number }) {
    this.regions = new ProceduralRegionManager({ worldSeed });
  }

  view({ position, ranges }: { position: VectorValue; ranges?: WorldRanges }) {
    return this.regions.query({ position, ranges });
  }

  sync({
    world,
    positions,
  }: {
    world: SimulationWorld;
    positions: VectorValue[];
  }) {
    const nearby = (entity: GameObject) =>
      positions.some(
        (position) =>
          entity.position.distanceTo(position) <=
          (entity instanceof Station
            ? serverRanges.stationPhysics
            : serverRanges.asteroid),
      );

    // Procedural sources are managed below. Runtime fragments and dropped cargo
    // must also leave the active simulation, but retain their state on return.
    this.sleeping.forEach((entity, id) => {
      if (!nearby(entity)) return;
      addEntity(world, entity);

      if (entity instanceof Station) this.managed.add(id);
      this.sleeping.delete(id);
    });
    world.entities.forEach((entity, id) => {
      if (
        this.managed.has(id) ||
        entity.playerId !== undefined ||
        nearby(entity)
      ) {
        return;
      }
      this.sleeping.set(id, entity);
      world.entities.delete(id);
    });
    const views = this.regions.queryMany({ positions, ranges: serverRanges });
    const wanted = new Set<number>();

    views.forEach((view) => {
      view.asteroids.forEach((description) => {
        wanted.add(description.id);

        if (world.entities.has(description.id)) return;
        // A managed object missing while its description is still in range was
        // destroyed or replaced by simulation children. Remove the procedural
        // source too, or the next regional sync would resurrect its parent on
        // top of those children.

        if (this.managed.has(description.id)) {
          this.regions.remove({ id: description.id });
          this.managed.delete(description.id);
          return;
        }

        addEntity(
          world,
          Object.assign(
            createAsteroid(world, {
              ...description,
              position: description.position.add(Vector()),
              velocity: Vector(),
            }),
            {
              pointCount: description.pointCount,
              radiusEven: description.radiusEven,
              resource: description.resource,
            },
          ),
        );
        this.managed.add(description.id);
      });

      view.stations.forEach((description) => {
        wanted.add(description.id);

        if (world.entities.has(description.id)) return;

        if (this.managed.has(description.id)) {
          this.regions.remove({ id: description.id });
          this.managed.delete(description.id);
          return;
        }

        const station = createStation({
          id: description.id,
          position: description.position.add(Vector()),
          radius: description.radius,
          spin: description.spin,
        });

        addEntity(world, station);
        this.managed.add(description.id);
      });

      view.wrecks.forEach((description) => {
        wanted.add(description.id);

        if (world.entities.has(description.id)) return;

        const wreck = Object.assign(
          createShip(world, {
            id: description.id,
            position: description.position.add(Vector()),
          }),
          {
            cargoContents: description.cargoContents.map((resource) =>
              createItem(world, { resource }),
            ),
            paint: description.paint,
          },
        );

        addEntity(world, wreck);
        this.managed.add(description.id);
      });
    });

    this.managed.forEach((id) => {
      if (!wanted.has(id)) {
        const entity = world.entities.get(id);

        if (entity instanceof Station) this.sleeping.set(id, entity);
        world.entities.delete(id);
        this.managed.delete(id);
      }
    });

    return views;
  }
}

export type ServerRegionalView = RegionalView;
export type ServerEntity = GameObject;
