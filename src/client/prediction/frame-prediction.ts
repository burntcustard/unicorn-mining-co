import * as Vec from '../utilities/vector';
import { interpolatePose } from '../utilities/interpolate-pose';
import { type GameObject } from '../objects/game-object';
import { Craft } from '../objects/craft';
import { type PredictedShot } from '../objects/ship';
import { type Projectile } from '../objects/projectile';
import { type Collider } from '../collision/types';
import { Station } from '../objects/station';
import { type PlayerId } from '../protocol/entities';
import { type InputFrame } from '../protocol/input-frame';
import {
  addEntity,
  createWorld,
  type SimulationWorld,
} from '../simulation/world';
import { simulationStep } from '../../specs/simulation';
import { updateWorld } from '../simulation/update-world';
import {
  captureWorld,
  cloneEntity,
  restoreWorld,
  type SimulationWorldState,
} from '../simulation/world-state';

/*
 * Predict the unfinished tick at display rate using the same gameplay/CCD as
 * the server. Every visible body shares the same endpoints, copied once per tick.
 * Resampling from that checkpoint makes results independent of display rate;
 * speculative damage, cargo transfers and events never escape into history.
 */
export class FramePrediction {
  private dueShots: PredictedShot[] = [];

  get shots(): readonly PredictedShot[] {
    return this.dueShots;
  }
  private pendingShots: (PredictedShot & {
    deathAt?: number;
    hit?: { collider: Collider; velocity: Vec.Value; spin: number };
  })[] = [];
  private copies = new WeakMap<object, any>();
  private endpoint?: Map<
    number,
    Pick<GameObject, 'position' | 'velocity' | 'rotation' | 'spin'> & {
      modules?: Map<number, number>;
    }
  >;
  private endpointChange?: InputFrame['changes'][number];
  private endpointInput?: InputFrame['input'];
  private state?: SimulationWorldState;
  private world = createWorld();

  reset() {
    this.copies = new WeakMap();
    this.invalidate();
  }

  invalidate() {
    this.dueShots = [];
    this.pendingShots = [];
    this.state = undefined;
    this.endpoint = undefined;
  }

  sample({
    world,
    playerId,
    input,
    elapsed,
  }: {
    world: SimulationWorld;
    playerId: PlayerId;
    input: InputFrame;
    elapsed: number;
  }) {
    const player = world.players.get(playerId);
    const ship = player && world.entities.get(player.shipId);

    if (!ship) {
      this.dueShots = [];
      return world;
    }

    const fresh = !this.state || this.state.tick !== world.tick;

    if (fresh) {
      this.dueShots = [];
      this.pendingShots = [];
      this.world.entities.clear();
      this.world.players = new Map([[playerId, { ...player! }]]);
      this.world.tick = world.tick;
      this.world.nextEntityId = world.nextEntityId;
      this.world.random.state = world.random.state;

      // Preserve authoritative iteration order for the contact solver.
      [...world.entities.values()].forEach((entity) => {
        const copy = cloneEntity({
          entity,
          copies: this.copies,
          // Unfitted station stock changes through dock commands, never through
          // a display tick. Trading reads the live world, so this isolated
          // motion solve needs its hull but not hundreds of shop items.
          includeCargo:
            !(entity instanceof Station) ||
            entity.mounts.some((mount) => mount.module),
        });

        copy.random = this.world.random;
        addEntity(this.world, copy);
      });

      [...world.entities.values()]
        .filter((entity) => entity.localMovementParent)
        .forEach((entity) => {
          this.world.entities.get(entity.id)!.localMovementParent =
            this.world.entities.get(
              (entity.localMovementParent as GameObject).id,
            );
        });

      this.state = captureWorld({ world: this.world });
      this.endpoint = undefined;
    }

    const dt = Math.max(0, Math.min(simulationStep, elapsed));

    if (dt > 0) {
      // A partial contact solve can switch projections between display frames.
      // Draw between fixed endpoints of the same full tick for every body.
      const change = input.changes.at(-1);

      if (
        !this.endpoint ||
        this.endpointInput !== input.input ||
        this.endpointChange !== change
      ) {
        // A newly copied world already is the start checkpoint. Only resampling
        // a previously solved endpoint needs to rewind mechanics first.
        if (!fresh) restoreWorld({ world: this.world, state: this.state! });

        this.pendingShots = [];

        updateWorld({
          onShot: (shot) => {
            if (shot.projectile.playerId === playerId) {
              this.pendingShots.push(shot);
            }
          },
          onProjectileHit: ({ projectile, collider }) => {
            const shot = this.pendingShots.find(
              (shot) => shot.projectile === projectile,
            );

            if (shot) {
              shot.hit = {
                collider: {
                  ...collider,
                  position: Vec.clone(collider.position),
                  shapeOutline: collider.shapeOutline?.map(([x, y]) => [x, y]),
                },
                velocity: Vec.clone(collider.owner.velocity),
                spin: collider.owner.spin,
              };
            }
          },
          world: this.world,
          inputs: new Map([[playerId, input]]),
          dt: simulationStep,
        });

        // The solved mechanics stay in this isolated world. Interpolation only
        // changes poses and turret bearings, so endpoints need only that data
        // rather than another checkpoint of every module and cargo item.
        this.endpoint = new Map(
          [...this.world.entities].map(([id, entity]) => [
            id,
            {
              position: Vec.clone(entity.position),
              velocity: Vec.clone(entity.velocity),
              rotation: entity.rotation,
              spin: entity.spin,
              modules:
                entity instanceof Craft
                  ? new Map(
                      entity.modules
                        .filter((module) => module.turret)
                        .map((module) => [module.id, module.aimRotation]),
                    )
                  : undefined,
            },
          ]),
        );

        for (const shot of this.pendingShots) {
          if (!shot.projectile.dead || !shot.hit) continue;
          const duration = Math.max(0, simulationStep - shot.offset);

          const fraction = shot.projectile.impactFraction({
            ...shot.hit,
            position: shot.position,
            endPosition: shot.projectile.position,
            dt: duration,
          });

          shot.deathAt = shot.offset + duration * fraction;

          const projectile = cloneEntity({
            entity: shot.projectile,
          }) as Projectile;

          projectile.dead = false;
          projectile.health = shot.health;
          projectile.world = this.world;
          Vec.set(
            projectile.position,
            Vec.addScaled(
              shot.position,
              Vec.subtract(projectile.position, shot.position),
              fraction,
            ),
          );
          shot.projectile = projectile;

          this.endpoint.set(projectile.id, {
            position: Vec.clone(projectile.position),
            velocity: Vec.clone(projectile.velocity),
            rotation: projectile.rotation,
            spin: projectile.spin,
          });
        }

        this.endpointInput = input.input;
        this.endpointChange = change;
      }

      if (dt < simulationStep) {
        this.world.entities.forEach((entity) => {
          const from = this.state!.entities.get(entity.id);
          const to = this.endpoint!.get(entity.id)!;

          if (!from) return;

          const pose = interpolatePose({
            from,
            to,
            fraction: dt / simulationStep,
            dt: simulationStep,
          });

          Vec.set(entity.position, pose.position);

          if (from.dockedTo && !entity.dockedTo && entity.launching) {
            // Launch facing snaps at the input edge instead of interpolating a turn.
            const launchOffset = input.input.launch
              ? 0
              : input.changes.find((change) => change.input.launch)?.offset ||
                0;

            entity.rotation = dt < launchOffset ? from.rotation : to.rotation;
          } else {
            entity.rotation = pose.rotation;
          }
        });
      } else {
        this.world.entities.forEach((entity) => {
          const to = this.endpoint!.get(entity.id)!;

          Vec.set(entity.position, to.position);
          entity.rotation = to.rotation;
        });
      }
    } else {
      if (!fresh) restoreWorld({ world: this.world, state: this.state! });
      this.endpoint = undefined;
      this.pendingShots = [];
    }

    // Keep full-tick mechanics cached, but expose births only after their
    // actual input/cooldown boundary. Resampling may move backward in time.
    this.dueShots = this.pendingShots.filter(
      (shot) => shot.offset <= dt + 1e-9,
    );

    if (this.endpoint) {
      for (const shot of this.pendingShots) {
        const entity = shot.projectile;
        const endpoint = this.endpoint.get(entity.id);

        if (
          shot.offset > dt + 1e-9 ||
          !endpoint ||
          entity.dead ||
          (shot.deathAt !== undefined && dt + 1e-9 >= shot.deathAt)
        ) {
          this.world.entities.delete(entity.id);
          continue;
        }

        const fraction = Math.min(
          1,
          Math.max(
            0,
            (dt - shot.offset) /
              ((shot.deathAt ?? simulationStep) - shot.offset || 1),
          ),
        );

        Vec.set(
          entity.position,
          Vec.addScaled(
            shot.position,
            Vec.subtract(endpoint.position, shot.position),
            fraction,
          ),
        );
        Vec.set(
          entity.velocity,
          dt < simulationStep ? shot.velocity : endpoint.velocity,
        );
        this.world.entities.set(entity.id, entity);
      }
    }

    // Visual phases advance on the live craft at display rate, outside history.
    // Refresh even cached endpoints so their markings never freeze between ticks.
    this.world.entities.forEach((entity) => {
      const source = world.entities.get(entity.id);

      if (!(entity instanceof Craft) || !(source instanceof Craft)) return;

      const modules = entity.modules;

      if (!modules.length) return;
      const liveModules = source.modules;
      const angles = this.endpoint?.get(entity.id)?.modules;

      modules.forEach((module) => {
        if (!module.mount) return;

        const end = angles?.get(module.id);
        const before =
          end !== undefined &&
          this.state!.entities.get(entity.id)?.moduleStates?.find(
            (state) => state.id === module.id,
          );

        if (end !== undefined && before) {
          const start = before.aimRotation ?? 0;
          const turn = end - start;

          // Sample the same tick fraction as the hull, including resampling
          // backward and crossing the -PI/PI boundary.
          module.aimRotation =
            dt === simulationStep
              ? end
              : start +
                Math.atan2(Math.sin(turn), Math.cos(turn)) *
                  (dt / simulationStep);
        }

        const live = liveModules.find(
          (candidate) => candidate.id === module.id,
        );

        if (!live || live.constructor !== module.constructor) return;
        const segments = source.segmentsAtMount(live.mount);

        entity.segmentsAtMount(module.mount).forEach((segment, index) => {
          if (segments[index]) segment.phase = segments[index].phase;
        });
      });
    });

    return this.world;
  }
}
