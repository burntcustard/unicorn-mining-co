import { forget, game } from './game';
import { Vector } from './vector';
import { getContext } from './core';
import { localMovement } from './local-movement';
import { SimulationEntity } from './shared/simulation/entity';

/**
 * Shared position and movement state for physical game objects. Position and
 * velocity default to zero Vectors; supplied properties replace the defaults.
 */
export class Sprite extends SimulationEntity {
  [key: string]: any;

  constructor(properties: any) {
    const { position = Vector(), velocity = Vector() } = properties;

    super({ id: properties.id || 0, ...properties, position, velocity });
    this.ctx = getContext();
    Object.assign(this, properties);
    this.add();
  }

  hitboxes() {
    return this.dead || this.buried ? [] : [this];
  }

  add() {
    this.dead = false;
    game.sprites.push(this);
  }

  remove() {
    this.dead = true;
    forget(game.sprites, this);
  }

  update(dt: number) {
    if (this.dead || this.buried) return;
    // @ifdef DEBUG
    if (!game.physicsOn) return;
    // @endif

    // Debris wears away rather than being counted down: `decay` is the health
    // it loses a second, and it is gone once that health is
    if (this.decay && (this.health -= this.decay * dt) <= 0) {
      this.remove();
      return;
    }

    super.update(dt);
    localMovement(this, game.crafts, dt);
  }
}
