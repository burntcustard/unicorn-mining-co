import { Vector, type Vector as VectorValue } from '../vector';
import { createAsteroid } from '../shared/simulation/asteroid';
import { createShip } from '../shared/simulation/ship';
import { createStation } from '../shared/simulation/station';
import {
  RegionManager as ProceduralRegionManager,
  worldRanges,
} from '../shared/simulation/region-manager';
import { addEntity, type SimulationWorld } from '../shared/simulation/world';
import {
  type RegionalView,
  type WorldRanges,
} from '../shared/protocol/regions';
import { type Entity, type StationEntity } from '../shared/protocol/entities';

const serverRanges: WorldRanges = {
  ...worldRanges,
  asteroid: 2500,
  stationPhysics: 2500,
  wreck: 2500,
};

export class RegionManager {
  private managed = new Set<number>();
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
    const views = positions.map((position) =>
      this.regions.query({ position, ranges: serverRanges }),
    );
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
              points: description.points,
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

        const station: StationEntity = createStation({
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
          { cargo: description.cargo, paint: description.paint },
        );

        addEntity(world, wreck);
        this.managed.add(description.id);
      });
    });

    this.managed.forEach((id) => {
      if (!wanted.has(id)) {
        world.entities.delete(id);
        this.managed.delete(id);
      }
    });

    return views;
  }

  markers({ position }: { position: VectorValue }) {
    return this.regions.query({
      position,
      ranges: { ...serverRanges, stationMarker: 11000 },
    }).stationMarkers;
  }
}

export type ServerRegionalView = RegionalView;
export type ServerEntity = Entity;
