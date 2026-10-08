import { autogunAmmunition } from '../../specs/items';
import { Laser } from './modules/laser';
import { Weapon } from './modules/weapon';
import { Projectile } from './projectile';
import { addEntity, entityId } from '../simulation/world';
import { applyForce } from '../physics/apply-force';
import { rotatePoint } from '../utilities/geometry';
import { drawSegment } from '../utilities/drawing';
import { game } from '../game';
import { hullSegmentFill } from '../utilities/lighting';
import { shipSpecsById, type ShipId } from '../../specs/ships';
import { type ShipSpec } from '../../specs/ships/types';
import { flight } from '../../specs/control-ship';
import * as Vec from '../utilities/vector';
import { Craft, type CraftRenderOptions } from './craft';
import { movePoint } from '../utilities/geometry';
import { approach } from '../utilities/approach';
import { type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld } from '../simulation/world';
import { type Pose, type Mount, type Segment } from '../types';
import { HornDrill } from './modules/horn-drill';
import { CargoHatch } from './modules/cargo-hatch';
import { moduleTypes } from './modules/index';
import { Module } from './modules/module';
import { Item } from './item';
import { paintColors } from '../../specs/colors';
import { type player as localPlayer } from '../player';
import { type CraftAction } from '../protocol/network';

type DockActionRequest =
  | Exclude<CraftAction, { action: 'buy' }>
  | { action: 'buy'; module: number; moduleId?: number };

export class Ship extends Craft {
  declare name: string;
  // Resist collision torque without changing the pilot's steering response.
  static angularInertiaScale = flight.angularInertiaScale;
  kind = 'ship';
  firing = false;

  /**
   * Apply one dock action to this ship. A local buy action gets its module ID
   * here; the server receives that ID and runs the same rules.
   */
  applyDockAction(
    action: DockActionRequest,
    player: Pick<typeof localPlayer, 'credits'>,
  ): CraftAction | undefined {
    const mount =
      'mount' in action && action.mount !== undefined
        ? this.mounts[action.mount]
        : undefined;

    if (action.action === 'sell') {
      const ids = action.objectIds;

      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > this.cargoContents.length ||
        ids.some((id) => !Number.isInteger(id)) ||
        new Set(ids).size !== ids.length
      ) {
        return;
      }

      const objects = ids.map((id) =>
        this.cargoContents.find((object) => object.id === id),
      );
      const objectsToSell = objects.filter(
        (object): object is Module | Item =>
          object instanceof Module || object instanceof Item,
      );

      if (objectsToSell.length !== ids.length) return;
      this.cargoContents = this.cargoContents.filter(
        (object) => !ids.includes(object.id),
      );
      player.credits += objectsToSell.reduce(
        (total, object) => total + (object.price || 0),
        0,
      );
    } else if (action.action === 'buyAmmo') {
      if (
        player.credits < autogunAmmunition.price ||
        this.cargoContents.length >= this.cargoSpace
      ) {
        return;
      }

      const item = new Item(autogunAmmunition, {
        world: this.world,
        id: entityId(this.world!),
      });

      this.cargoContents.push(item);
      player.credits -= autogunAmmunition.price;
      return action;
    } else if (action.action === 'buy') {
      const Type = moduleTypes[action.module];
      const objects = [...this.modules, ...this.cargoContents];

      if (
        !Type ||
        player.credits < Type.price ||
        this.cargoContents.length >= this.cargoSpace ||
        objects.some((object) => object.id === action.moduleId)
      ) {
        return;
      }

      // Restored server IDs share the negative range with local allocations.
      const module = new Type({
        id: action.moduleId ?? Math.min(0, ...objects.map(({ id }) => id)) - 1,
      });

      player.credits -= Type.price;
      this.cargoContents.push(module);
      return { ...action, moduleId: module.id };
    } else if (action.action === 'equip') {
      const module = this.modules.find(({ id }) => id === action.moduleId);

      if (!mount || !module || !mount.fits.includes(module.constructor)) return;
      this.fit(module, mount);
    } else if (action.action === 'repair') {
      if (action.mount === undefined) {
        if (action.moduleId !== undefined) return;
        const cost = this.repairCost();

        if (!(cost > 0) || player.credits < cost) return;
        player.credits -= cost;
        this.fixHull();
      } else {
        if (!mount?.module || mount.module.id !== action.moduleId) return;
        const cost = this.repairCost(mount);

        if (!(cost > 0) || player.credits < cost) return;
        player.credits -= cost;
        mount.health = mount.module.health || mount.module.healthActivated;

        if (mount.module.health === 0) mount.healthActivated = mount.health;
      }
    } else if (action.action === 'paint') {
      const shades = paintColors[action.paint];
      const module =
        action.moduleId === undefined
          ? undefined
          : action.mount === undefined
            ? this.modules.find(({ id }) => id === action.moduleId)
            : mount?.module;

      if (
        !shades ||
        (action.mount !== undefined &&
          (!mount?.module || mount.module.id !== action.moduleId)) ||
        (action.moduleId !== undefined && !module)
      ) {
        return;
      }

      if (module) module.shades = shades;
      else this.shades = shades;
      this.segments
        .filter((segment) =>
          module ? segment.module === module : segment.hull,
        )
        .forEach((segment) => (segment.shades = shades));
    } else if (action.action === 'remove') {
      if (!mount) return;
      this.fit(0, mount);
    } else {
      return;
    }

    return action;
  }

  constructor({
    shipType = 'mustang',
    spec = shipSpecsById.get(shipType),
    ...properties
  }: ConstructorParameters<typeof Craft>[0] & {
    shipType?: ShipId;
    spec?: ShipSpec;
  } = {}) {
    if (!spec) throw new Error(`Unknown ship spec: ${shipType}`);

    super({
      ...spec,
      ...properties,
    });

    this.definitionId = shipType === 'mustang' ? undefined : shipType;
  }

  // This hull has one engine mount; each nozzle belongs to the same module.
  get engine(): any {
    for (const segment of this.segments) {
      if (!segment.mounts) continue;

      for (const mount of segment.mounts) {
        const module = mount.module;

        if (
          module &&
          module.forwardThrust &&
          module.mount &&
          !(module.mount.health < 1)
        ) {
          return module;
        }
      }
    }

    for (const object of this.cargoContents) {
      if (
        object instanceof Module &&
        object.forwardThrust &&
        object.mount &&
        !(object.mount.health < 1)
      ) {
        return object;
      }
    }

    return {};
  }

  fly(forward: number, turn: number) {
    this.forward = forward;
    this.turn = turn;

    this.segments.forEach((segment) => {
      if (segment.module.forwardThrust) {
        segment.active =
          turn && segment.thrusterNozzleSide
            ? turn === -segment.thrusterNozzleSide
              ? 1
              : forward * flight.steeringEase
            : forward;
        segment.active *= this.launchThrottle;
      }
    });
  }

  get forwardThrust() {
    return (this.engine.forwardThrust || 0) * this.launchThrottle ** 2;
  }

  handleContacts({
    contacts,
    events,
    world,
    dt,
  }: {
    contacts: Contact[];
    events: SimulationEvent[];
    world: SimulationWorld;
    dt: number;
  }) {
    const hornDrills = new Map<
      Segment,
      {
        contact: Contact;
        hornDrill: Contact['collider'];
        target: Contact['collider'];
      }
    >();

    contacts.forEach((contact) => {
      const { collider, other } = contact;
      const own =
        collider.owner === this
          ? collider
          : other.owner === this
            ? other
            : undefined;

      if (own?.segment?.module instanceof CargoHatch) {
        own.segment.module.collect({ ship: this, contact, events, world });
      }

      const hornDrill = own;

      if (
        !hornDrill?.segment ||
        !(hornDrill.segment.module instanceof HornDrill) ||
        hornDrill.role !== 'hornDrill'
      ) {
        return;
      }

      const target = hornDrill === collider ? other : collider;
      const current = hornDrills.get(hornDrill.segment);

      if (!current || contact.depth > current.contact.depth) {
        hornDrills.set(hornDrill.segment, { contact, hornDrill, target });
      }
    });

    hornDrills.forEach(({ contact, hornDrill, target }) => {
      (hornDrill.segment!.module as HornDrill).drill({
        ship: this,
        segment: hornDrill.segment!,
        target,
        position: contact.point,
        events,
        world,
        dt,
      });
    });
  }

  get hullHealthTotal() {
    return this.segments
      .filter(({ hull }) => hull)
      .reduce((total, segment) => total + segment.health, 0);
  }

  get hullMaxHealth() {
    return this.hullSegments.reduce(
      (total, segment) => total + (segment.health ?? 0),
      0,
    );
  }

  // Half-size nozzles retain the original quarter-thrust launch coast.
  // Return to full power for the last 0.05 seconds of launch.
  get launchThrottle() {
    return this.launching > flight.launchHalfThreshold &&
      this.launching <= flight.launchHalfEnd
      ? flight.launchThrottle
      : 1;
  }

  // Only a crewed ship flies: wreckage and stations have no cockpit to fly from
  get maxSpeed() {
    return (
      (this.cockpit && flight.speedPerThrust * this.forwardThrust) ||
      flight.uncrewedMaxSpeed
    );
  }

  render(options: CraftRenderOptions = {}) {
    super.render({
      ...options,
      drawHull: ({
        segment,
        health,
        pose,
      }: {
        segment: Segment;
        health: number;
        pose: Pose;
      }) => {
        const { ctx } = game;
        const worn =
          health < (segment.module.health || segment.module.healthActivated) / 2
            ? 0
            : +!!segment.hull;

        ctx.fillStyle = hullSegmentFill({
          ctx,
          segment,
          worn,
          rotation: pose.rotation,
        });

        ctx.strokeStyle = segment.shades[2];
        drawSegment({ ctx, segment });
      },
    });
  }

  repairCost(mount?: Mount) {
    if (!mount) return this.hullMaxHealth - (this.hullHealthTotal | 0);
    return mount.module
      ? (mount.module.health || mount.module.healthActivated) -
          ((mount.health ?? 0) | 0)
      : 0;
  }

  get rotationalThrust() {
    return (this.engine.rotationalThrust || 0) * this.launchThrottle ** 2;
  }

  get thrust() {
    return this.forward || 0;
  }

  set thrust(value: number) {
    this.fly(value, this.turn || 0);
  }

  resolveLasers(dt: number, events: SimulationEvent[]) {
    for (const module of this.modules) {
      if (module instanceof Laser) module.resolveHits(this, dt, events);
    }
  }

  fireWeapons(dt: number) {
    if (
      !this.world ||
      this.playerId === undefined ||
      !this.world.players.has(this.playerId) ||
      this.dead ||
      this.dockedTo ||
      this.launching
    ) {
      return;
    }

    for (const module of this.modules) {
      if (!(module instanceof Weapon) || !module.mount) continue;
      module.fireCooldown -= dt;
      const active = this.segments.some(
        (segment) =>
          segment.module === module &&
          segment.active &&
          segment.activationProgress === 1 &&
          segment.mount.health > 0,
      );

      if (!this.firing || !active || module.chargeCooldown > 1e-9) {
        module.fireCooldown = Math.max(0, module.fireCooldown);
        continue;
      }

      while (module.fireCooldown <= 1e-9) {
        if (module.ammunition !== undefined) {
          const index = this.cargoContents.findIndex(
            (item) => item.resource === module.ammunition && item.rounds > 0,
          );

          if (index < 0) {
            module.fireCooldown = 0;
            break;
          }

          if (!--this.cargoContents[index].rounds) {
            this.cargoContents.splice(index, 1);
          }
        }

        const position = Vec.add(
          this.position,
          rotatePoint(
            Vec.add(
              module.mount.localPosition,
              Vec.create(module.barrelLength + module.projectile.radius + 1, 0),
            ),
            this.rotation,
          ),
        );
        const velocity = Vec.add(
          this.velocity,
          rotatePoint(Vec.create(module.projectile.speed, 0), this.rotation),
        );

        addEntity(
          this.world,
          new Projectile(module.definitionId, {
            id: entityId(this.world),
            world: this.world,
            position,
            velocity,
            playerId: this.playerId,
          }),
        );

        if (module.recoil) {
          applyForce(
            this,
            rotatePoint(Vec.create(-module.recoil, 0), this.rotation),
          );
        }

        module.fireCooldown += module.fireInterval;
      }
    }
  }

  update(dt: number) {
    if (this.launching) {
      this.launching = Math.max(0, this.launching - dt);
      this.fly(this.forward, this.turn);
    }

    if (this.cockpit && !this.dockedTo) {
      const push =
        ((flight.thrustScale * this.forwardThrust) / this.mass) *
        this.forward *
        dt;
      const rotationalThrust = this.rotationalThrust;
      const targetSpin =
        (this.turn *
          this.turnRate *
          rotationalThrust *
          this.launchThrottle ** 2) /
        flight.spinDivisor;

      this.spin = approach(this.spin, targetSpin, rotationalThrust * dt);
      Vec.set(
        this.velocity,
        movePoint(this.velocity, this.rotation + this.spin * dt, push),
      );
    }

    super.update(dt);
    this.fireWeapons(dt);
  }
}
