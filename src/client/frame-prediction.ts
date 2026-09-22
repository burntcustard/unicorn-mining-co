import { type PlayerId } from '../shared/protocol/entities';
import { type InputFrame } from '../shared/protocol/input-frame';
import {
  addEntity,
  createWorld,
  type SimulationWorld,
} from '../shared/simulation/world';
import { simulationStep } from '../shared/simulation/update-tier';
import { updateWorld } from '../shared/simulation/update-world';
import {
  captureWorld,
  cloneEntity,
  restoreWorld,
  type SimulationWorldState,
} from '../shared/physics/serializer/world-state';

/*
 * Predict the unfinished tick at display rate using the same gameplay/CCD as
 * the server. Only the pilot's contact neighbourhood is copied, once per tick.
 * Resampling from that checkpoint makes results independent of display rate;
 * speculative damage, cargo transfers and events never escape into history.
 */
export class FramePrediction {
  private world = createWorld();
  private state?: SimulationWorldState;

  reset() {
    this.state = undefined;
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
    if (!ship) return world;

    if (!this.state || this.state.tick !== world.tick) {
      const nearby = new Set([ship]);
      const candidates = [...world.entities.values()];
      // Include contact chains and moving bodies that can reach us this tick,
      // rather than predicting the pilot through a stationary neighbour.
      for (const member of nearby)
        candidates.forEach((entity) => {
          if (
            !entity.dead &&
            !nearby.has(entity) &&
            member.position.distanceTo(entity.position) <=
              member.radius +
                entity.radius +
                100 +
                (member.velocity.length() + entity.velocity.length()) *
                  simulationStep
          )
            nearby.add(entity);
        });

      this.world.entities.clear();
      this.world.players = new Map([[playerId, { ...player! }]]);
      this.world.tick = world.tick;
      this.world.nextEntityId = world.nextEntityId;
      this.world.random.state = world.random.state;
      // Preserve authoritative iteration order for the contact solver.
      candidates
        .filter((entity) => nearby.has(entity))
        .forEach((entity) => {
          const copy = cloneEntity({ entity });
          copy.random = this.world.random;
          addEntity(this.world, copy);
        });
      nearby.forEach((entity) => {
        this.world.entities.get(entity.id)!.localMovementParent =
          this.world.entities.get(entity.localMovementParent?.id);
      });
      this.state = captureWorld({ world: this.world });
    }

    restoreWorld({ world: this.world, state: this.state });
    const dt = Math.max(0, Math.min(simulationStep, elapsed));
    if (dt > 0)
      updateWorld({
        world: this.world,
        inputs: new Map([[playerId, input]]),
        dt,
      });
    return this.world;
  }
}
