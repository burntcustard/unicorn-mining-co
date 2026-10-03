import * as Vec from '../utilities/vector';
import { simulationStep } from '../../definitions/simulation';
import { type SimulationWorld } from '../simulation/world';
import { type Pose } from '../types';

type Correction = Pose & { correctedAt: number };

/*
 * All hulls use the same predicted timeline. Only reconciliation error is
 * eased away; buffering snapshots would delay every remote control change.
 */
export class RemoteMotion {
  private corrections = new Map<number, Correction>();

  reset() {
    this.corrections.clear();
  }

  correct({
    before,
    now,
    world,
    predicted,
  }: {
    before: Map<number, Pose & { dockedTo?: number }>;
    now: number;
    world: SimulationWorld;
    predicted: SimulationWorld;
    shipId?: number;
  }) {
    this.corrections.clear();
    before.forEach((pose, id) => {
      const entity = world.entities.get(id);
      const current = predicted.entities.get(id) || entity;

      if (
        !current ||
        !entity ||
        pose.dockedTo !== entity.dockedTo ||
        Vec.distance(pose.position, current.position) > 1000
      ) {
        return;
      }

      const turn = pose.rotation - current.rotation;

      this.corrections.set(id, {
        position: Vec.subtract(pose.position, current.position),
        rotation: Math.atan2(Math.sin(turn), Math.cos(turn)),
        correctedAt: now,
      });
    });
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

    world?.entities.forEach((entity, id) => {
      const current = predicted?.entities.get(id) || entity;
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
      poses.set(id, pose);
    });
    return poses;
  }
}
