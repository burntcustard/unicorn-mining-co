import * as Vec from '../utilities/vector';
import { interpolatePose } from '../utilities/interpolate-pose';
import { type GameObject } from '../objects/game-object';
import { type PlayerId } from '../protocol/entities';
import { type InputFrame } from '../protocol/input-frame';
import {
  addEntity,
  createWorld,
  type SimulationWorld,
} from '../simulation/world';
import { simulationStep } from '../../definitions/simulation';
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
  private endpoint?: SimulationWorldState;
  private endpointChange?: InputFrame['changes'][number];
  private endpointInput?: InputFrame['input'];
  private state?: SimulationWorldState;
  private world = createWorld();

  reset() {
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

    if (!ship) return world;

    if (!this.state || this.state.tick !== world.tick) {
      this.world.entities.clear();
      this.world.players = new Map([[playerId, { ...player! }]]);
      this.world.tick = world.tick;
      this.world.nextEntityId = world.nextEntityId;
      this.world.random.state = world.random.state;
      // Preserve authoritative iteration order for the contact solver.
      [...world.entities.values()].forEach((entity) => {
        const copy = cloneEntity({ entity });

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
        restoreWorld({ world: this.world, state: this.state });
        updateWorld({
          world: this.world,
          inputs: new Map([[playerId, input]]),
          dt: simulationStep,
        });
        this.endpoint = captureWorld({ world: this.world });
        this.endpointInput = input.input;
        this.endpointChange = change;
      } else restoreWorld({ world: this.world, state: this.endpoint });

      if (dt === simulationStep) return this.world;
      this.world.entities.forEach((entity) => {
        const from = this.state!.entities.get(entity.id);

        if (!from) return;
        const pose = interpolatePose({
          from,
          to: entity,
          fraction: dt / simulationStep,
          dt: simulationStep,
        });

        Vec.set(entity.position, pose.position);
        entity.rotation = pose.rotation;
      });
    } else restoreWorld({ world: this.world, state: this.state });
    return this.world;
  }
}
