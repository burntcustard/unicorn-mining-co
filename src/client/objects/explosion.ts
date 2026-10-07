import { type GameObject } from './game-object';
import { Asteroid } from './asteroid';
import { damage as applyDamage } from './damage';
import { contactBetween } from '../collision/contact-between';
import { type Collider, outlineColorOf } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { type EffectSpec } from '../effects/effect';
import { applyForce } from '../physics/apply-force';
import * as Vec from '../utilities/vector';
import { createRandom } from '../utilities/seeded-random';

export const explode = ({
  damage = 0,
  effect,
  events = [],
  exclude,
  impulse,
  maxSpeed = Infinity,
  object,
  radius,
}: {
  damage?: number;
  effect?: EffectSpec;
  events?: SimulationEvent[];
  exclude?: Collider;
  impulse: number;
  maxSpeed?: number;
  object: GameObject;
  radius: number;
}) => {
  const { world } = object;

  if (!world) return;

  if (effect) {
    events.push({
      effect,
      objectId: object.id,
      position: Vec.clone(object.position),
      type: 'explosion',
    });
  }

  const targetOf = (collider: Collider) =>
    collider.asteroidSegment || collider.segment || collider.owner;
  const healthOf = (collider: Collider) =>
    collider.segment?.mount || targetOf(collider);

  // Snapshot the targets: fragments and resources from this blast are pushed,
  // but must not receive the damage a second time.
  if (damage) {
    const entities = [...world.entities.values()];

    for (const entity of entities) {
      if (entity === object || entity.dead || entity.buried) continue;

      if (
        Vec.distance(entity.position, object.position) >
        radius + entity.radius
      ) {
        continue;
      }

      const damaged = new Set();

      if (exclude) damaged.add(healthOf(exclude));

      for (const collider of entity.hitbox()) {
        if (collider.physics === false || collider.pickupPoint) continue;
        const contact = contactBetween(
          { position: object.position, radius },
          collider,
        );
        const target = healthOf(collider);

        if (!contact || damaged.has(target)) continue;
        const applied = applyDamage(targetOf(collider), damage);

        if (!applied) continue;
        damaged.add(target);

        events.push({
          type: 'collision',
          a: object.id,
          b: entity.id,
          impact: 0,
          colors: ['', outlineColorOf(collider)],
          damage: [0, applied],
          position: contact.point,
        });
      }

      if (entity instanceof Asteroid) {
        entity.fracture({
          asteroidSegment: entity.segments?.find(
            (segment) => segment.health < 1,
          ),
          by: object.playerId,
          events,
          world,
        });
      }
    }
  }

  for (const entity of world.entities.values()) {
    if (entity === object || entity.dead || entity.buried) continue;
    const offset = Vec.subtract(entity.position, object.position);
    const distance = Vec.length(offset);
    const falloff = 1 - Math.max(0, distance - entity.radius) / radius;

    if (falloff <= 0) continue;
    const force = Math.min(impulse, maxSpeed * entity.mass) * falloff;
    // Cap angular impulse independently of mass and the linear speed limit;
    // applyForce then gives heavier bodies proportionally less spin.
    const spin =
      (createRandom(object.id + entity.id * 48271).next() * 2 - 1) *
      Math.min(impulse / Math.max(1, entity.radius), 6) *
      falloff;

    applyForce(
      entity,
      Vec.scale(Vec.normalize(distance ? offset : object.velocity), force),
      spin,
    );
  }
};
