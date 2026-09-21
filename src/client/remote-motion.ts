import { Vector, type Vector as VectorValue } from '../shared/vector';
import { type ReplicatedEntity } from '../shared/protocol/network';
import { simulationStep, updateTiers } from '../shared/simulation/update-tier';
import { type SimulationWorld } from '../shared/simulation/world';

type Frame = {
  tick: number;
  position: VectorValue;
  rotation: number;
  dockedTo?: number;
};

// Blend over 25m, reaching the collision pose before the hulls can touch.
const contactMargin = 25;

/*
 * Presentation only: never feed these delayed poses back into physics.
 * One on-screen snapshot interval gives us two known endpoints to draw between.
 * If packets stop, hold the last endpoint instead of guessing another turn.
 */
export class RemoteMotion {
  private frames = new Map<number, Frame[]>();
  private serverTick = 0;
  private receivedAt = 0;
  private renderTick = -Infinity;

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
    this.serverTick = tick;
    this.receivedAt = now;
    const retained = new Set(entityIds);
    this.frames.forEach((_, id) => {
      if (!retained.has(id)) this.frames.delete(id);
    });
    entities.forEach((entity) => {
      if (
        entity.id === shipId ||
        entity.playerId === undefined ||
        entity.kind !== 'ship'
      )
        return;
      let frames = this.frames.get(entity.id) || [];
      const previous = frames.at(-1);
      if (previous && tick <= previous.tick) return;
      // Docking/teleporting is a discontinuity, not a flight across the screen.
      const position = Vector(entity.position.x, entity.position.y);
      if (
        previous &&
        (previous.dockedTo !== entity.dockedTo ||
          previous.position.distanceTo(position) > 1000)
      )
        frames = [];
      frames.push({
        tick,
        position,
        rotation: entity.rotation,
        dockedTo: entity.dockedTo,
      });
      this.frames.set(entity.id, frames.slice(-4));
    });
  }

  sample({
    now = performance.now(),
    world,
    shipId,
  }: { now?: number; world?: SimulationWorld; shipId?: number } = {}) {
    const local =
      shipId === undefined ? undefined : world?.entities.get(shipId);
    this.renderTick = Math.max(
      this.renderTick,
      this.serverTick +
        Math.min(
          (now - this.receivedAt) / (simulationStep * 1000),
          updateTiers.visible.replicateEvery,
        ) -
        updateTiers.visible.replicateEvery,
    );
    const poses = new Map<number, Pick<Frame, 'position' | 'rotation'>>();
    this.frames.forEach((frames, id) => {
      const to =
        frames.find((frame) => frame.tick >= this.renderTick) || frames.at(-1)!;
      const from = frames[Math.max(0, frames.indexOf(to) - 1)];
      const fraction =
        to.tick === from.tick
          ? 1
          : Math.max(
              0,
              Math.min(
                1,
                (this.renderTick - from.tick) / (to.tick - from.tick),
              ),
            );
      const angle = Math.atan2(
        Math.sin(to.rotation - from.rotation),
        Math.cos(to.rotation - from.rotation),
      );
      const pose = {
        position: from.position.add(
          to.position.subtract(from.position).scale(fraction),
        ),
        rotation: from.rotation + angle * fraction,
      };
      const predicted = world?.entities.get(id);
      if (local && predicted) {
        // Mixing a predicted local hull with a delayed remote hull invents
        // gaps/overlap at contact. Blend into the shared simulation pose before
        // contact; distant free flight keeps its non-extrapolated presentation.
        const gap =
          Math.min(
            local.position.distanceTo(pose.position),
            local.position.distanceTo(predicted.position),
          ) -
          local.radius -
          predicted.radius;
        const travel =
          predicted.velocity.subtract(local.velocity).length() *
          simulationStep *
          updateTiers.visible.replicateEvery;
        const weight = Math.max(
          0,
          Math.min(1, (2 * contactMargin + travel - gap) / contactMargin),
        );
        pose.position = pose.position.add(
          predicted.position.subtract(pose.position).scale(weight),
        );
        const turn = predicted.rotation - pose.rotation;
        pose.rotation =
          weight === 1
            ? predicted.rotation
            : pose.rotation +
              Math.atan2(Math.sin(turn), Math.cos(turn)) * weight;
      }
      poses.set(id, pose);
    });
    return poses;
  }
}
