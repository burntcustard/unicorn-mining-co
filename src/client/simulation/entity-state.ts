import * as Vec from '../utilities/vector';
import { type GameObject } from '../objects/game-object';
import { Craft, type ModuleState } from '../objects/craft';
import { Item } from '../objects/item';
import { Module } from '../objects/modules/module';

/*
 * Checkpoints retain model geometry and identities, not cloned class graphs.
 * Only mutable mechanics are copied. Removed objects stay alive in history
 * until that history expires, allowing drilling and cargo transfers to rewind.
 */
const fields = [
  'opening',
  'openingTarget',
  'sweepStart',
  'definitionId',
  'playerId',
  'rotation',
  'rotationJump',
  'spin',
  'mass',
  'friction',
  'radius',
  'dead',
  'pendingUpdateTime',
  'health',
  'maxHealth',
  'decay',
  'buried',
  'launching',
  'transitTime',
  'transitGate',
  'dockedTo',
  'forward',
  'firing',
  'fuel',
  'turn',
  'localMovementRate',
  'localMovementParent',
  'shapeOutline',
  'segments',
  'contents',
  'resource',
  'rounds',
  'pointCount',
  'radiusEven',
] as const;

const valuesOf = (target: any, keys: readonly string[]) => {
  const values: Record<string, any> = {};

  keys.forEach((key) => {
    values[key] = target[key];
  });

  return values;
};

const cargoStates = new WeakMap<Item | Module, EntityState>();

type CapturedState = { target: any; values: Record<string, any> };

const healthStates = new WeakMap<object, CapturedState>();
const mechanicsStates = new WeakMap<object, CapturedState>();
const mechanicsFields = [
  'health',
  'healthActivated',
  'localPosition',
  'active',
  'activationProgress',
  'fireCooldown',
  'chargeCooldown',
  'biting',
  'mount',
  'module',
] as const;

export class EntityState {
  private readonly capturedStates: CapturedState[] = [];
  private readonly cargoContents?: EntityState[];
  private readonly cargoSharedRandom?: Uint8Array;
  readonly cargoIds?: number[];
  readonly cargoRounds?: (number | undefined)[];
  private readonly cockpit?: Craft['cockpit'];
  readonly dockedTo: number;
  readonly entity: GameObject;
  readonly health: number;
  readonly hullHealth?: number[];
  readonly launching: number;
  readonly transitTime: number;
  readonly transitGate: number;
  readonly moduleStates?: ModuleState[];
  readonly position: Vec.Value;
  private readonly randomState: number;
  readonly rotation: number;
  private readonly segments?: Craft['segments'];
  readonly spin: number;
  private readonly values: any[];
  readonly velocity: Vec.Value;

  constructor(entity: GameObject) {
    this.entity = entity;
    this.position = Vec.clone(entity.position);
    this.velocity = Vec.clone(entity.velocity);
    this.rotation = entity.rotation;
    this.spin = entity.spin;
    this.health = entity.health;
    this.launching = entity.launching;
    this.transitTime = entity.transitTime;
    this.transitGate = entity.transitGate;
    this.dockedTo = entity.dockedTo;
    this.randomState = entity.random.state;
    this.values = fields.map((key) => entity[key]);

    if (entity.segments && !(entity instanceof Craft)) {
      this.capturedStates.push(
        ...entity.segments.map((segment: any) => {
          let state = healthStates.get(segment);

          if (!state || state.values.health !== segment.health) {
            state = { target: segment, values: { health: segment.health } };
            healthStates.set(segment, state);
          }

          return state;
        }),
      );
    }

    if (entity instanceof Craft) {
      this.hullHealth = entity.hullHealth;
      this.moduleStates = entity.moduleStates;
      this.cargoIds = entity.cargoContents.map((object) => object.id);
      this.cargoRounds = entity.cargoContents.map((object) => object.rounds);
      this.segments = [...entity.segments];
      this.cockpit = entity.cockpit;

      this.cargoSharedRandom = new Uint8Array(entity.cargoContents.length);

      this.cargoContents = entity.cargoContents.map((object, index) => {
        const sharedRandom = object.random === entity.random;

        this.cargoSharedRandom![index] = +sharedRandom;
        const reusable =
          object instanceof Item ||
          (object instanceof Module && !object.segments);
        let state = reusable && cargoStates.get(object as Item | Module);

        if (!state || !state.unchanged({ entity: object, sharedRandom })) {
          state = new EntityState(object);

          if (reusable) cargoStates.set(object as Item | Module, state);
        }

        // Shared RNG belongs to this checkpoint, not an unchanged stock item.
        // Keep the captured seed even if RNG object identities later change.
        return state;
      });

      const targets = new Set<any>([
        ...entity.segments,
        ...entity.mounts,
        ...entity.modules,
      ]);

      targets.forEach((target) => {
        let state = mechanicsStates.get(target);

        if (
          !state ||
          mechanicsFields.some((key) => state.values[key] !== target[key])
        ) {
          state = { target, values: valuesOf(target, mechanicsFields) };
          mechanicsStates.set(target, state);
        }

        this.capturedStates.push(state);
      });
    }
  }

  private unchanged({
    entity,
    sharedRandom,
  }: {
    entity: GameObject;
    sharedRandom: boolean;
  }) {
    if (
      entity.position.x !== this.position.x ||
      entity.position.y !== this.position.y ||
      entity.velocity.x !== this.velocity.x ||
      entity.velocity.y !== this.velocity.y ||
      (!sharedRandom && entity.random.state !== this.randomState)
    ) {
      return false;
    }

    for (let index = 0; index < fields.length; index++) {
      if (entity[fields[index]] !== this.values[index]) return false;
    }

    return true;
  }

  restore({ randomState = this.randomState }: { randomState?: number } = {}) {
    const entity = this.entity;

    for (let index = 0; index < fields.length; index++) {
      (entity as any)[fields[index]] = this.values[index];
    }

    Vec.set(entity.position, this.position);
    Vec.set(entity.velocity, this.velocity);
    entity.random.state = randomState;
    this.capturedStates.forEach(({ target, values }) =>
      Object.assign(target, values),
    );

    if (entity instanceof Craft) {
      entity.segments = [...this.segments!];
      entity.cockpit = this.cockpit;

      entity.cargoContents = this.cargoContents!.map((state, index) =>
        state.restore({
          randomState: this.cargoSharedRandom![index]
            ? this.randomState
            : undefined,
        }),
      );
    }

    return entity;
  }
}
