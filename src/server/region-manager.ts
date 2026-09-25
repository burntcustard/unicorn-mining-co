import * as Vec from '../shared/vector';
import { createAsteroid } from '../shared/simulation/asteroid';
import { createShip } from '../shared/craft/create-ship';
import { itemTypes } from '../shared/items';
import { createStation } from '../shared/craft/create-station';
import { worldRanges } from '../shared/settings';
import { RegionManager as ProceduralRegionManager } from '../shared/simulation/region-manager';
import {
  addEntity,
  entityId,
  type SimulationWorld,
} from '../shared/simulation/world';
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

  view({ position, ranges }: { position: Vec.Value; ranges?: WorldRanges }) {
    return this.regions.query({ position, ranges });
  }

  sync({
    world,
    positions,
  }: {
    world: SimulationWorld;
    positions: Vec.Value[];
  }) {
    const nearby = (entity: GameObject) =>
      positions.some(
        (position) =>
          Vec.distance(entity.position, position) <=
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
        if (wanted.has(description.id)) return;
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
              position: Vec.clone(description.position),
              velocity: Vec.create(),
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
        if (wanted.has(description.id)) return;
        wanted.add(description.id);

        if (world.entities.has(description.id)) return;

        if (this.managed.has(description.id)) {
          this.regions.remove({ id: description.id });
          this.managed.delete(description.id);
          return;
        }

        const station = createStation({
          id: description.id,
          position: Vec.clone(description.position),
          radius: description.radius,
          spin: description.spin,
        });

        addEntity(world, station);
        this.managed.add(description.id);
      });

      view.wrecks.forEach((description) => {
        if (wanted.has(description.id)) return;
        wanted.add(description.id);

        if (world.entities.has(description.id)) return;

        const wreck = Object.assign(
          createShip(world, {
            id: description.id,
            position: Vec.clone(description.position),
          }),
          {
            cargoContents: description.cargoContents.map(
              (resource) =>
                new itemTypes[resource]({ world, id: entityId(world) }),
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
