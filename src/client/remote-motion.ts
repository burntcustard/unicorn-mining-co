import * as Vec from '../shared/vector';
import { type ReplicatedEntity } from '../shared/protocol/network';
import {
  maxPredictionTicks,
  simulationStep,
  updateTiers,
} from '../shared/settings';
import { updateTier } from '../shared/simulation/update-tier';
import { type SimulationWorld } from '../shared/simulation/world';
import { type Pose } from '../shared/types';

type Frame = Pose & {
  tick: number;
  dockedTo?: number;
};

type Track = {
  frames: Frame[];
  interval: number;
  replicateEvery: number;
  receivedAt: number;
  renderTick: number;
};

// Blend over 25m, reaching the collision pose before the hulls can touch.
const contactMargin = 25;

const interpolate = ({
  from,
  to,
  fraction,
}: {
  from: Pose;
  to: Pose;
  fraction: number;
}) => ({
  position: Vec.addScaled(
    from.position,
    Vec.subtract(to.position, from.position),
    fraction,
  ),
  rotation:
    from.rotation +
    Math.atan2(
      Math.sin(to.rotation - from.rotation),
      Math.cos(to.rotation - from.rotation),
    ) *
      fraction,
});

/*
 * Presentation only: never feed these delayed poses back into physics.
 * Each object's snapshot interval gives us two known endpoints to draw between.
 * If packets stop, hold the last endpoint instead of guessing another turn.
 */
export class RemoteMotion {
  private tracks = new Map<number, Track>();
  private snapshotTick = 0;
  private sampledAt = 0;

  reset() {
    this.tracks.clear();
    this.snapshotTick = 0;
    this.sampledAt = 0;
  }

  receive({
    entities,
    entityIds,
    shipId,
    tick,
    now = performance.now(),
  }: {
    entities: ReplicatedEntity[];
    entityIds: number[];
    shipId?: number;
    tick: number;
    now?: number;
  }) {
    const snapshotInterval = Math.max(
      1,
      Math.min(maxPredictionTicks, tick - this.snapshotTick),
    );

    this.snapshotTick = tick;
    const retained = new Set(entityIds);

    this.tracks.forEach((_, id) => {
      if (!retained.has(id)) this.tracks.delete(id);
    });
    const ship = entities.find((entity) => entity.id === shipId);
    const observers = ship ? [{ position: Vec.clone(ship.position) }] : [];

    entities.forEach((entity) => {
      if (entity.id === shipId) return;
      const track = this.tracks.get(entity.id) || {
        frames: [],
        interval: updateTiers.visible.replicateEvery,
        replicateEvery: updateTiers.visible.replicateEvery,
        receivedAt: now,
        renderTick: -Infinity,
      };
      const previous = track.frames.at(-1);

      if (previous && tick <= previous.tick) return;
      // Docking/teleporting is a discontinuity, not a flight across the screen.
      const position = Vec.clone(entity.position);

      if (
        previous &&
        (previous.dockedTo !== entity.dockedTo ||
          Vec.distance(previous.position, position) > 1000)
      ) {
        track.frames = [];
        track.renderTick = -Infinity;
      }
      track.frames.push({
        tick,
        position,
        rotation: entity.rotation,
        dockedTo: entity.dockedTo,
      });
      track.frames = track.frames.slice(-4);
      track.receivedAt = now;

      if (observers.length) {
        track.replicateEvery = updateTier({
          entity: { position },
          observers,
        }).replicateEvery;
      }
      track.interval = Math.max(snapshotInterval, track.replicateEvery);
      this.tracks.set(entity.id, track);
    });
  }

  sample({
    now = performance.now(),
    world,
    predicted = world,
    shipId,
  }: {
    now?: number;
    world?: SimulationWorld;
    predicted?: SimulationWorld;
    shipId?: number;
  } = {}) {
    const local =
      shipId === undefined ? undefined : predicted?.entities.get(shipId);
    const poses = new Map<number, Pose>(
      [...(predicted?.entities.values() || [])].map((entity) => [
        entity.id,
        { position: Vec.clone(entity.position), rotation: entity.rotation },
      ]),
    );

    const elapsed = Math.max(0, now - this.sampledAt) / (simulationStep * 1000);

    this.sampledAt = Math.max(this.sampledAt, now);
    this.tracks.forEach((track, id) => {
      const { frames, interval, receivedAt } = track;

      const latest = frames.at(-1)!.tick;

      // Advance at render speed, holding at the newest known pose. One extra
      // tick (33ms) behind the arrival clock bounds buffering and catches up
      // immediately after a stall instead of accumulating presentation delay.
      track.renderTick = Math.max(
        track.renderTick,
        Math.min(latest, track.renderTick + elapsed),
        latest +
          Math.min((now - receivedAt) / (simulationStep * 1000), interval) -
          interval -
          1,
      );
      const to =
        frames.find((frame) => frame.tick >= track.renderTick) ||
        frames.at(-1)!;
      const from = frames[Math.max(0, frames.indexOf(to) - 1)];
      const fraction =
        to.tick === from.tick
          ? 1
          : Math.max(
              0,
              Math.min(
                1,
                (track.renderTick - from.tick) / (to.tick - from.tick),
              ),
            );
      const pose = interpolate({ from, to, fraction });
      const entity = world?.entities.get(id);
      const predictedPose = poses.get(id) || entity;

      if (local && predictedPose && entity) {
        // Mixing a predicted local hull with a delayed remote hull invents
        // gaps/overlap at contact. Blend into the shared simulation pose before
        // contact; distant free flight keeps its non-extrapolated presentation.
        const gap =
          Math.min(
            Vec.distance(local.position, pose.position),
            Vec.distance(local.position, predictedPose.position),
          ) -
          local.radius -
          entity.radius;
        const travel =
          Vec.length(Vec.subtract(entity.velocity, local.velocity)) *
          simulationStep *
          updateTiers.visible.replicateEvery;
        const weight = Math.max(
          0,
          Math.min(1, (2 * contactMargin + travel - gap) / contactMargin),
        );

        pose.position = Vec.addScaled(
          pose.position,
          Vec.subtract(predictedPose.position, pose.position),
          weight,
        );
        const turn = predictedPose.rotation - pose.rotation;

        pose.rotation =
          weight === 1
            ? predictedPose.rotation
            : pose.rotation +
              Math.atan2(Math.sin(turn), Math.cos(turn)) * weight;
      }
      poses.set(id, pose);
    });
    return poses;
  }
}
