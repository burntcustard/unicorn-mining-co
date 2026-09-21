import { type Vector } from '../vector';
import {
  type Entity,
  type PlayerId,
  type ShipEntity,
} from '../shared/protocol/entities';
import {
  emptyPlayerInput,
  sameInput,
  type PlayerInput,
} from '../shared/protocol/input';
import { simulationStep, updateWorld } from '../shared/simulation/update-world';
import { type SimulationWorld } from '../shared/simulation/world';
import {
  captureWorld,
  cloneEntity,
  restoreWorld,
  type SimulationWorldState,
} from '../shared/simulation/world-state';

export type SimulationCheckpoint = {
  acknowledgedSequence?: number;
  dockedTo?: number;
  drill: boolean;
  entityId: number;
  hatch: boolean;
  health: number;
  inputLead?: number;
  launching?: number;
  light: boolean;
  playerId: number;
  position: Vector;
  rotation: number;
  shield: boolean;
  spin: number;
  thrust: number;
  tick: number;
  turn: number;
  velocity: Vector;
};

const historyLength = 120;

// @ifdef DEBUG
/** How hard the server has had to argue with the prediction lately. */
export const predictionStats = { corrections: 0, steps: 0, worst: 0 };

Object.assign(globalThis, { predictionStats });
// @endif

const matches = ({
  ship,
  checkpoint,
}: {
  ship: ShipEntity;
  checkpoint: SimulationCheckpoint;
}) =>
  ship.position.distanceTo(checkpoint.position) < 0.25 &&
  ship.velocity.distanceTo(checkpoint.velocity) < 0.25 &&
  Math.abs(ship.rotation - checkpoint.rotation) < 0.002 &&
  Math.abs(ship.spin - checkpoint.spin) < 0.002 &&
  (ship.launching || 0) === (checkpoint.launching || 0) &&
  ship.health === checkpoint.health &&
  ship.dockedTo === checkpoint.dockedTo;

const applyCheckpoint = ({
  ship,
  checkpoint,
}: {
  ship: ShipEntity;
  checkpoint: SimulationCheckpoint;
}) => {
  ship.position.set(checkpoint.position);
  ship.velocity.set(checkpoint.velocity);
  ship.rotation = checkpoint.rotation;
  ship.spin = checkpoint.spin;
  ship.health = checkpoint.health;
  ship.dockedTo = checkpoint.dockedTo;
  ship.launching = checkpoint.launching;
  ship.drill = checkpoint.drill;
  ship.hatch = checkpoint.hatch;
  ship.light = checkpoint.light;
  ship.shield = checkpoint.shield;
  ship.thrust = checkpoint.thrust;
  ship.turn = checkpoint.turn;
};

/** Copy one replicated entity over the client's own copy of it. */
const applyEntity = ({
  entity,
  server,
}: {
  entity: Entity;
  server: Entity;
}) => {
  entity.position.set(server.position);
  entity.velocity.set(server.velocity);
  entity.rotation = server.rotation;
  entity.spin = server.spin;
  entity.mass = server.mass;
  entity.radius = server.radius;
  if (entity.kind === 'asteroid' && server.kind === 'asteroid') {
    entity.contents = [...server.contents];
    entity.decay = server.decay;
    entity.health = server.health;
    entity.maxHealth = server.maxHealth;
    entity.outline = server.outline?.map(([x, y]) => [x, y]);
    entity.sections = server.sections?.map((section) => ({
      ...section,
      contents: [...section.contents],
      outline: section.outline.map(([x, y]) => [x, y]),
    }));
  } else if (entity.kind === 'ship' && server.kind === 'ship') {
    entity.cargo = server.cargo && [...server.cargo];
    entity.dockedTo = server.dockedTo;
    entity.drill = server.drill;
    entity.hatch = server.hatch;
    entity.health = server.health;
    entity.launching = server.launching;
    entity.light = server.light;
    entity.maxSpeed = server.maxSpeed;
    entity.paint = server.paint;
    entity.playerId = server.playerId;
    entity.shield = server.shield;
    entity.thrust = server.thrust;
    entity.turn = server.turn;
  }
};

export class PredictionManager {
  private history = new Map<number, SimulationWorldState>();
  private lastSent?: PlayerInput;
  private localInputs = new Map<number, PlayerInput>();
  private localPlayerId?: PlayerId;
  private sequence = 0;
  private world: SimulationWorld;

  constructor({ world }: { world: SimulationWorld }) {
    this.world = world;
  }

  setLocalPlayer({ playerId }: { playerId: PlayerId }) {
    this.localPlayerId = playerId;
  }

  reset() {
    this.history.clear();
    this.lastSent = undefined;
  }

  step({
    input,
    send,
  }: {
    input: PlayerInput;
    send: (message: {
      input: PlayerInput;
      sequence: number;
      tick: number;
    }) => void;
  }) {
    if (this.localPlayerId === undefined) return;
    const tick = this.world.tick;

    // A pilot holding a key says the same thing every tick, and both sides read
    // back the newest input at or before a tick, so only changes are recorded.
    if (!this.lastSent || !sameInput(this.lastSent, input)) {
      const savedInput = { ...input };

      this.lastSent = savedInput;
      this.localInputs.set(tick, savedInput);
      send({ input: savedInput, sequence: ++this.sequence, tick });
    }
    this.simulate({ tick });
    this.trim();
  }

  /**
   * Put the world back to the tick the server is reporting on, take its word
   * for that tick, and predict forward again from there.
   */
  reconcile({
    checkpoints,
    entities,
    tick,
  }: {
    checkpoints: SimulationCheckpoint[];
    entities?: Entity[];
    tick: number;
  }) {
    const targetTick = this.world.tick;
    const state = tick <= targetTick ? this.history.get(tick) : undefined;

    if (!state) {
      // Nothing was predicted for that tick, so there is nothing to correct
      // against: the server's word is all the client has.
      this.applyServerState({ checkpoints, entities });
      if (tick > targetTick) this.world.tick = tick;
      this.history.clear();
      return;
    }

    const own = checkpoints.find(
      ({ playerId }) => playerId === this.localPlayerId,
    );
    const predicted = own && state.entities.get(own.entityId);

    if (
      !own ||
      (predicted?.kind === 'ship' &&
        matches({ ship: predicted, checkpoint: own }))
    ) {
      // The pilot's own prediction held. Everything else is only as old as the
      // message, so it is set right and carried forward on its own rather than
      // dragging the whole world back through a replay.
      this.applyServerState({
        checkpoints: checkpoints.filter((checkpoint) => checkpoint !== own),
        entities,
        exclude: own?.entityId,
        catchUp: targetTick - tick,
      });
      this.discardBefore({ tick });
      return;
    }

    restoreWorld({ world: this.world, state });
    this.applyServerState({ checkpoints, entities });
    // @ifdef DEBUG
    predictionStats.corrections++;
    predictionStats.worst = Math.max(
      predictionStats.worst,
      predicted!.position.distanceTo(own.position),
    );
    // @endif
    this.replayTo({ targetTick });
    this.discardBefore({ tick });
  }

  /**
   * The server's list is the whole of what the client should have: anything
   * missing from it has drifted out of range or was only ever guessed at.
   */
  private applyServerState({
    checkpoints,
    entities,
    exclude,
    catchUp = 0,
  }: {
    checkpoints: SimulationCheckpoint[];
    entities?: Entity[];
    exclude?: number;
    catchUp?: number;
  }) {
    if (entities) {
      const replicated = new Set(entities.map(({ id }) => id));

      [...this.world.entities.keys()].forEach((id) => {
        if (!replicated.has(id)) this.world.entities.delete(id);
      });
      entities.forEach((server) => {
        const entity = this.world.entities.get(server.id);

        if (server.id === exclude) return;
        if (entity && entity.kind === server.kind)
          applyEntity({ entity, server });
        else
          this.world.entities.set(server.id, cloneEntity({ entity: server }));
        this.world.nextEntityId = Math.max(
          this.world.nextEntityId,
          server.id + 1,
        );
      });
    }
    checkpoints.forEach((checkpoint) => {
      const ship = this.world.entities.get(checkpoint.entityId);

      if (ship?.kind === 'ship') applyCheckpoint({ ship, checkpoint });
    });
    [...this.world.entities.values()].forEach((entity) => {
      for (let left = entity.id === exclude ? 0 : catchUp; left--;)
        entity.update(simulationStep);
    });
  }

  private replayTo({ targetTick }: { targetTick: number }) {
    while (this.world.tick < targetTick)
      this.simulate({ tick: this.world.tick });
    this.trim();
  }

  private simulate({ tick }: { tick: number }) {
    // @ifdef DEBUG
    predictionStats.steps++;
    // @endif
    // Recorded before the step, so a replay overwrites what the corrected run
    // left behind rather than measuring the next correction against it.
    this.history.set(tick, captureWorld({ world: this.world }));

    const inputs = new Map<PlayerId, PlayerInput>();
    const input = this.inputAt({ inputs: this.localInputs, tick });

    inputs.set(this.localPlayerId!, input || emptyPlayerInput());
    updateWorld(this.world, inputs);
  }

  private inputAt({
    inputs,
    tick,
  }: {
    inputs?: Map<number, PlayerInput>;
    tick: number;
  }) {
    if (!inputs) return;
    let value: PlayerInput | undefined;
    let valueTick = -Infinity;

    [...inputs].forEach(([inputTick, candidate]) => {
      if (inputTick <= tick && inputTick > valueTick) {
        value = candidate;
        valueTick = inputTick;
      }
    });
    return value;
  }

  private discardBefore({ tick }: { tick: number }) {
    [...this.history.keys()].forEach((historyTick) => {
      if (historyTick < tick) {
        this.history.delete(historyTick);
      }
    });
  }

  private trim() {
    const oldest = this.world.tick - historyLength;

    this.discardBefore({ tick: oldest });
    // The newest input at or before a tick still speaks for every tick after
    // it, so only ones another already stands in front of are dropped.
    const newestStale = [...this.localInputs.keys()]
      .filter((tick) => tick <= oldest)
      .sort((a, b) => a - b)
      .at(-1);

    if (newestStale !== undefined)
      [...this.localInputs.keys()].forEach((tick) => {
        if (tick < newestStale) this.localInputs.delete(tick);
      });
  }
}
