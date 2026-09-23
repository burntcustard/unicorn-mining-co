import { type GameObject } from '../game-object';
import { Vector } from '../vector';
import { Craft } from '../craft/craft';

/*
 * Checkpoints retain model geometry and identities, not cloned class graphs.
 * Only mutable mechanics are copied. Removed objects stay alive in history
 * until that history expires, allowing mining and cargo transfers to rewind.
 */
const fields = [
  'rotation',
  'spin',
  'mass',
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
  'sections',
  'contents',
  'resource',
  'points',
  'radiusEven',
] as const;

export class EntityState {
  readonly entity: GameObject;
  readonly position: Vector;
  readonly velocity: Vector;
  readonly rotation: number;
  readonly spin: number;
  readonly health: number;
  readonly launching: number;
  readonly dockedTo: number;
  readonly hullHealth?: number[];
  private readonly values: Record<string, any>;
  private readonly parts: { target: any; values: Record<string, any> }[] = [];
  private readonly cargo?: EntityState[];
  private readonly segments?: Craft['segments'];
  private readonly cockpit?: Craft['cockpit'];
  private readonly randomState: number;

  constructor(entity: GameObject) {
    this.entity = entity;
    this.position = entity.position.add(Vector());
    this.velocity = entity.velocity.add(Vector());
    this.rotation = entity.rotation;
    this.spin = entity.spin;
    this.health = entity.health;
    this.launching = entity.launching;
    this.dockedTo = entity.dockedTo;
    this.randomState = entity.random.state;
    this.values = Object.fromEntries(fields.map((key) => [key, entity[key]]));

    if (entity.sections) {
      this.parts.push(
        ...entity.sections.map((section: any) => ({
          target: section,
          values: { health: section.health },
        })),
      );
    }

    if (entity instanceof Craft) {
      this.hullHealth = entity.hullHealth;
      this.segments = [...entity.segments];
      this.cockpit = entity.cockpit;
      this.cargo = entity.cargoContents.map(
        (object) => new EntityState(object),
      );
      const targets = new Set<any>([
        ...entity.segments,
        ...entity.mounts,
        ...entity.modules,
      ]);

      targets.forEach((target) =>
        this.parts.push({
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
    entity.position.set(this.position);
    entity.velocity.set(this.velocity);
    entity.random.state = this.randomState;
    this.parts.forEach(({ target, values }) => Object.assign(target, values));

    if (entity instanceof Craft) {
      entity.segments = [...this.segments!];
      entity.cockpit = this.cockpit;
      entity.cargoContents = this.cargo!.map((state) => state.restore());
      entity.segments.forEach((segment) => {
        segment.hitbox = undefined;
      });
    }
    return entity;
  }
}
