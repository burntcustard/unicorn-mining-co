import * as Vec from '../utilities/vector';
import { type GameObject } from '../objects/game-object';
import { Craft, type ModuleState } from '../objects/craft';

/*
 * Checkpoints retain model geometry and identities, not cloned class graphs.
 * Only mutable mechanics are copied. Removed objects stay alive in history
 * until that history expires, allowing drilling and cargo transfers to rewind.
 */
const fields = [
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
  'dockedTo',
  'forward',
  'firing',
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

export class EntityState {
  private readonly capturedStates: {
    target: any;
    values: Record<string, any>;
  }[] = [];
  private readonly cargoContents?: EntityState[];
  readonly cargoIds?: number[];
  readonly cargoRounds?: (number | undefined)[];
  private readonly cockpit?: Craft['cockpit'];
  readonly dockedTo: number;
  readonly entity: GameObject;
  readonly health: number;
  readonly hullHealth?: number[];
  readonly launching: number;
  readonly moduleStates?: ModuleState[];
  readonly position: Vec.Value;
  private readonly randomState: number;
  readonly rotation: number;
  private readonly segments?: Craft['segments'];
  readonly spin: number;
  private readonly values: Record<string, any>;
  readonly velocity: Vec.Value;

  constructor(entity: GameObject) {
    this.entity = entity;
    this.position = Vec.clone(entity.position);
    this.velocity = Vec.clone(entity.velocity);
    this.rotation = entity.rotation;
    this.spin = entity.spin;
    this.health = entity.health;
    this.launching = entity.launching;
    this.dockedTo = entity.dockedTo;
    this.randomState = entity.random.state;
    this.values = Object.fromEntries(fields.map((key) => [key, entity[key]]));

    if (entity.segments) {
      this.capturedStates.push(
        ...entity.segments.map((segment: any) => ({
          target: segment,
          values: { health: segment.health },
        })),
      );
    }

    if (entity instanceof Craft) {
      this.hullHealth = entity.hullHealth;
      this.moduleStates = entity.moduleStates;
      this.cargoIds = entity.cargoContents.map((object) => object.id);
      this.cargoRounds = entity.cargoContents.map((object) => object.rounds);
      this.segments = [...entity.segments];
      this.cockpit = entity.cockpit;
      this.cargoContents = entity.cargoContents.map(
        (object) => new EntityState(object),
      );
      const targets = new Set<any>([
        ...entity.segments,
        ...entity.mounts,
        ...entity.modules,
      ]);

      targets.forEach((target) =>
        this.capturedStates.push({
          target,
          values: Object.fromEntries(
            [
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
            ].map((key) => [key, target[key]]),
          ),
        }),
      );
    }
  }

  restore() {
    const entity = this.entity;

    Object.assign(entity, this.values);
    Vec.set(entity.position, this.position);
    Vec.set(entity.velocity, this.velocity);
    entity.random.state = this.randomState;
    this.capturedStates.forEach(({ target, values }) =>
      Object.assign(target, values),
    );

    if (entity instanceof Craft) {
      entity.segments = [...this.segments!];
      entity.cockpit = this.cockpit;
      entity.cargoContents = this.cargoContents!.map((state) =>
        state.restore(),
      );

      entity.segments.forEach((segment) => {
        segment.collider = undefined;
      });
    }

    return entity;
  }
}
