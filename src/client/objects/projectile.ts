import { withAlpha } from '../utilities/color';
import { GameObject, type RenderOptions } from './game-object';
import { game } from '../game';
import { moduleSpecs, type WeaponId } from '../../specs/modules';
import { type ModuleSpec } from '../../specs/modules/types';
import * as Vec from '../utilities/vector';
import { CircleShape } from '../collision/shape/circle-shape';
import { PolygonShape } from '../collision/shape/polygon-shape';
import { Sweep } from '../physics/motion-sweep';
import { findTimeOfImpact } from '../collision/time-of-impact';
import { type Collider, outlineColorOf } from '../collision/types';
import { damage } from './damage';
import { explode } from './explosion';
import { Asteroid } from './asteroid';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld } from '../simulation/world';

export class Projectile extends GameObject {
  declare definitionId: WeaponId;
  sweepStart: Vec.Value;

  constructor(
    definitionId: WeaponId,
    properties: ConstructorParameters<typeof GameObject>[0] = {},
  ) {
    const spec = moduleSpecs[definitionId];

    super({
      kind: 'projectile',
      definitionId,
      physics: false,
      radius: spec.projectile.radius,
      health: spec.damage,
      ...properties,
    });

    this.sweepStart = Vec.clone(this.position);
  }

  hitbox(): Collider[] {
    return [];
  }

  captureSweep() {
    this.sweepStart = Vec.clone(this.position);
  }

  update(dt: number) {
    const spec = moduleSpecs[this.definitionId];

    this.health -= (spec.damage / (spec.projectile.lifetime / 1000)) * dt;

    if (this.health <= 0) return this.remove();
    Vec.addScaled(this.position, this.velocity, dt, this.position);
    this.roundMotion();
  }

  onDeath(events: SimulationEvent[], exclude?: Collider) {
    const {
      effect,
      explosion,
      fadeOut,
    }: NonNullable<ModuleSpec['projectile']> =
      moduleSpecs[this.definitionId].projectile;

    if (fadeOut && !exclude) return;

    if (explosion) explode({ object: this, events, exclude, ...explosion });
    else if (effect) {
      events.push({
        effect,
        objectId: this.id,
        position: Vec.clone(this.position),
        type: 'explosion',
      });
    }
  }

  get deathEvent(): SimulationEvent | undefined {
    const spec = moduleSpecs[this.definitionId];

    const { fadeOut }: NonNullable<ModuleSpec['projectile']> = spec.projectile;

    if (fadeOut) return;

    return {
      type: 'objectDestroyed',
      objectId: this.id,
      color: spec.projectile.color,
      damage: spec.damage,
      position: Vec.clone(this.position),
    };
  }

  resolveHits(events: SimulationEvent[], world: SimulationWorld, dt: number) {
    if (this.dead) return;
    let first: Collider | undefined;
    let fraction = 1;
    const shot = new CircleShape(Vec.create(), this.radius);
    const sweepA = new Sweep();
    const travel = Vec.distance(this.sweepStart, this.position);

    Vec.set(sweepA.c0, this.sweepStart);
    Vec.set(sweepA.c, this.position);

    for (const entity of world.entities.values()) {
      if (
        entity === this ||
        entity.dead ||
        entity.buried ||
        entity.kind === 'projectile' ||
        (this.playerId !== undefined && entity.playerId === this.playerId)
      ) {
        continue;
      }

      const reach =
        entity.radius + this.radius + travel + Vec.length(entity.velocity) * dt;

      if (Vec.distanceSquared(entity.position, this.position) > reach * reach) {
        continue;
      }

      for (const collider of entity.hitbox()) {
        if (
          (collider.physics === false &&
            !(entity.kind === 'station' && collider.segment?.hull)) ||
          collider.pickupPoint
        ) {
          continue;
        }

        const shape = collider.shapeOutline?.length
          ? new PolygonShape(
              collider.shapeOutline.map(([x, y]) => Vec.create(x, y)),
              collider.collisionMargin,
            )
          : new CircleShape(Vec.create(), collider.radius);
        const sweepB = new Sweep();

        Vec.set(sweepB.c, collider.position);
        Vec.addScaled(collider.position, entity.velocity, -dt, sweepB.c0);
        sweepB.a = collider.rotation;
        sweepB.a0 = collider.rotation - entity.spin * dt;
        const result = { touching: false, t: fraction };

        findTimeOfImpact(result, {
          proxyA: shot,
          proxyB: shape,
          sweepA,
          sweepB,
          tMax: fraction,
        });

        if (
          (result.touching || result.t === 0) &&
          (!first || result.t < fraction)
        ) {
          first = collider;
          fraction = result.t;
        }
      }
    }

    if (!first) return;

    if (first.physics === false) return this.remove();

    const spec = moduleSpecs[this.definitionId];
    const target = first.asteroidSegment || first.segment || first.owner;
    const applied = damage(target, spec.damage);
    const selfApplied = damage(this, spec.damage);

    Vec.addScaled(
      this.sweepStart,
      Vec.subtract(this.position, this.sweepStart),
      fraction,
      this.position,
    );

    events.push({
      type: 'collision',
      a: this.id,
      b: first.owner.id,
      impact: Vec.distance(this.velocity, first.owner.velocity),
      colors: [spec.projectile.color, outlineColorOf(first)],
      damage: [selfApplied, applied],
      position: Vec.clone(this.position),
    });

    if (this.health <= 0) {
      this.remove();
      this.onDeath(events, first);
    }

    if (first.owner instanceof Asteroid) {
      first.owner.fracture({
        asteroidSegment: first.asteroidSegment,
        by: this.playerId,
        events,
        world,
      });
    }
  }

  render({ pose = this }: RenderOptions = {}) {
    const spec = moduleSpecs[this.definitionId];
    const { color, glow, fadeOut }: NonNullable<ModuleSpec['projectile']> =
      spec.projectile;

    super.render({
      pose,
      draw: () => {
        const { ctx } = game;

        if (fadeOut) {
          const remaining =
            (this.health / spec.damage) * spec.projectile.lifetime;

          ctx.globalAlpha *= Math.max(0, Math.min(1, remaining / fadeOut));
        }

        if (glow) {
          const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, glow.radius);

          gradient.addColorStop(0, withAlpha(glow));
          gradient.addColorStop(1, withAlpha({ color: '#000', alpha: 0 }));
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(0, 0, glow.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
      },
    });
  }
}
