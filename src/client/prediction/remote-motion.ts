import * as Vec from '../utilities/vector';
import { maxPredictionTicks } from '../../specs/prediction';
import { simulationStep } from '../../specs/simulation';
import { type SimulationWorld } from '../simulation/world';
import { type Pose } from '../types';
import { type ShipMovement } from '../network/movement-channel';

type Correction = Pose & { correctedAt: number };

type ReceivedMovement = ShipMovement & { receivedAt: number };

type ProjectedMovement = ReceivedMovement & {
  startedAt: number;
  elapsed: number;
};

const movementTimeout = 150;

/*
 * All hulls use the same predicted timeline. Only reconciliation error is
 * eased away; buffering snapshots would delay every remote control change.
 */
export class RemoteMotion {
  private corrections = new Map<number, Correction>();
  private pendingMovement = new Map<number, ReceivedMovement>();
  private movement = new Map<number, ProjectedMovement>();
  private lastMovementTick = -1;
  private movementTickLimit = 0;

  get hasMovement() {
    return this.pendingMovement.size > 0 || this.movement.size > 0;
  }

  receiveMovement({
    samples,
    serverTick,
    worldTick,
    now = performance.now(),
  }: {
    samples: ShipMovement[];
    serverTick: number;
    worldTick: number;
    now?: number;
  }) {
    const tick = samples[0]?.tick;

    if (
      tick === undefined ||
      tick <= Math.max(serverTick, this.lastMovementTick) ||
      tick > Math.min(worldTick + 1, serverTick + maxPredictionTicks)
    ) {
      return;
    }

    this.lastMovementTick = tick;

    for (const sample of samples) {
      this.pendingMovement.set(sample.id, { ...sample, receivedAt: now });
    }
  }

  updateMovement({
    now,
    world,
    predicted,
    shipId,
    serverTick,
    renderTick,
  }: {
    now: number;
    world: SimulationWorld;
    predicted: SimulationWorld;
    shipId?: number;
    serverTick: number;
    renderTick: number;
  }) {
    this.movementTickLimit = serverTick + maxPredictionTicks;
    const presentationTick = Math.min(renderTick, this.movementTickLimit);
    const fresh = (sample: ReceivedMovement) =>
      sample.tick > serverTick &&
      sample.tick <= Math.min(world.tick + 1, this.movementTickLimit) &&
      world.tick - sample.tick <= 8 &&
      now - sample.receivedAt < movementTimeout;
    const ids = new Set([
      ...this.movement.keys(),
      ...this.pendingMovement.keys(),
    ]);
    const pilot = predicted.entities.get(shipId ?? 0);

    for (const id of ids) {
      const entity = world.entities.get(id);

      if (
        id === shipId ||
        entity?.kind !== 'ship' ||
        entity.dead ||
        entity.dockedTo ||
        entity.launching ||
        entity.transitTime
      ) {
        if (this.movement.delete(id)) this.corrections.delete(id);
        continue;
      }

      const current = predicted.entities.get(id) || entity;
      const previous = this.movement.get(id);
      const sample = this.pendingMovement.get(id);

      const next =
        sample && fresh(sample)
          ? {
              ...sample,
              startedAt: now,
              elapsed:
                Math.max(0, presentationTick - sample.tick) * simulationStep,
            }
          : undefined;

      const target = next && this.projectMovement(next, now);
      // Near contact, retain the shared predicted hull geometry.
      const contactRange = pilot ? (pilot.radius + entity.radius + 16) ** 2 : 0;
      const clearOfPilot = (position: Vec.Value) =>
        !pilot || Vec.distanceSquared(position, pilot.position) > contactRange;
      const beforeTarget = this.movementPose(id, current, now);
      const clear =
        clearOfPilot(current.position) && clearOfPilot(beforeTarget.position);
      const nearby =
        target &&
        clear &&
        clearOfPilot(target.position) &&
        Vec.distance(target.position, current.position) <= 1000;

      if (!nearby && (!previous || (clear && fresh(previous)))) continue;

      const before = this.displayPose(id, beforeTarget, now);

      if (next && nearby) {
        this.movement.set(id, next);
      } else {
        this.movement.delete(id);
      }

      this.setCorrection(id, before, this.movementPose(id, current, now), now);
    }

    this.pendingMovement.clear();
  }

  private projectMovement(sample: ProjectedMovement, now: number) {
    const maxElapsed =
      Math.max(0, Math.min(5, this.movementTickLimit - sample.tick)) *
      simulationStep;
    const elapsed = Math.min(
      maxElapsed,
      sample.elapsed + Math.max(0, now - sample.startedAt) / 1000,
    );

    return {
      position: Vec.addScaled(sample.position, sample.velocity, elapsed),
      rotation: sample.rotation + sample.spin * elapsed,
    };
  }

  private movementPose(id: number, current: Pose, now: number) {
    const sample = this.movement.get(id);

    return sample ? this.projectMovement(sample, now) : current;
  }

  private setCorrection(id: number, before: Pose, current: Pose, now: number) {
    const turn = before.rotation - current.rotation;

    this.corrections.set(id, {
      position: Vec.subtract(before.position, current.position),
      rotation: Math.atan2(Math.sin(turn), Math.cos(turn)),
      correctedAt: now,
    });
  }

  correct({
    before,
    now,
    world,
    predicted,
  }: {
    before: Map<
      number,
      Pose & {
        dockedTo?: number;
        kind?: string;
        shapeOutline?: number[][];
      }
    >;
    now: number;
    world: SimulationWorld;
    predicted: SimulationWorld;
    shipId?: number;
  }) {
    this.corrections.clear();
    const moving = this.movement.size > 0;

    before.forEach((pose, id) => {
      const entity = world.entities.get(id);
      const current = predicted.entities.get(id) || entity;
      const target =
        moving && current ? this.movementPose(id, current, now) : current;

      if (
        !current ||
        !target ||
        !entity ||
        (pose.kind !== undefined && pose.kind !== entity.kind) ||
        (pose.kind === 'asteroid' &&
          (pose.shapeOutline?.length !== current.shapeOutline?.length ||
            pose.shapeOutline?.some((point, index) =>
              point.some(
                (value, axis) =>
                  Math.abs(value - current.shapeOutline[index][axis]) > 1e-6,
              ),
            ))) ||
        pose.dockedTo !== entity.dockedTo ||
        Vec.distance(pose.position, target.position) > 1000
      ) {
        return;
      }

      this.setCorrection(id, pose, target, now);
    });
  }

  reset() {
    this.corrections.clear();
    this.clearMovement();
  }

  clearMovement() {
    this.lastMovementTick = -1;
    this.pendingMovement.clear();
    this.movement.clear();
  }

  private displayPose(id: number, current: Pose, now: number) {
    const pose = {
      position: Vec.clone(current.position),
      rotation: current.rotation,
    };

    const correction = this.corrections.get(id);

    if (correction) {
      // Small errors retain the fast exponential release. After an outage,
      // limit correction speed to 60 units/s and 3 radians/s so a large
      // disagreement cannot teleport the displayed hull in a single frame.
      const duration = Math.max(
        Vec.length(correction.position) / 60,
        Math.abs(correction.rotation) / 3,
      );
      const elapsed = Math.max(0, now - correction.correctedAt) / 1000;
      const ease = simulationStep / 2;
      const linear = Math.max(0, duration - ease);
      const remaining =
        elapsed < linear
          ? duration - elapsed
          : Math.min(duration, ease) * Math.exp(-(elapsed - linear) / ease);
      const decay = duration ? remaining / duration : 0;

      Vec.addScaled(pose.position, correction.position, decay, pose.position);
      pose.rotation += correction.rotation * decay;
    }

    return pose;
  }

  sample({
    now = performance.now(),
    world,
    predicted = world,
  }: {
    now?: number;
    world?: SimulationWorld;
    predicted?: SimulationWorld;
    shipId?: number;
  } = {}) {
    const poses = new Map<number, Pose>();
    const moving = this.movement.size > 0;

    world?.entities.forEach((entity, id) => {
      const current = predicted?.entities.get(id) || entity;

      poses.set(
        id,
        this.displayPose(
          id,
          moving ? this.movementPose(id, current, now) : current,
          now,
        ),
      );
    });

    return poses;
  }
}
