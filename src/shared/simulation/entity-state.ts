import * as Vec from '../vector';
import { type GameObject } from '../game-object';
import { Craft } from '../craft/craft';
import { type ModuleState } from '../craft/module-state';

/*
 * Checkpoints retain model geometry and identities, not cloned class graphs.
 * Only mutable mechanics are copied. Removed objects stay alive in history
 * until that history expires, allowing drilling and cargo transfers to rewind.
 */
const fields = [
  'rotation',
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
  'turn',
  'localMovementRate',
  'localMovementParent',
  'outline',
  'segments',
  'contents',
  'resource',
  'pointCount',
  'radiusEven',
] as const;

export class EntityState {
  readonly entity: GameObject;
  readonly position: Vec.Value;
  readonly velocity: Vec.Value;
  readonly rotation: number;
  readonly spin: number;
  readonly health: number;
  readonly launching: number;
  readonly dockedTo: number;
  readonly hullHealth?: number[];
  readonly moduleStates?: ModuleState[];
  readonly credits?: number;
  readonly cargoIds?: number[];
  private readonly values: Record<string, any>;
  private readonly capturedStates: {
    target: any;
    values: Record<string, any>;
  }[] = [];
  private readonly cargoContents?: EntityState[];
  private readonly segments?: Craft['segments'];
  private readonly cockpit?: Craft['cockpit'];
  private readonly randomState: number;

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
      this.credits = entity.credits;
      this.cargoIds = entity.cargoContents.map((object) => object.id);
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
              'active',
              'activationProgress',
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
