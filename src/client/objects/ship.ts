import { drawHullSegment } from './hull-rendering';
import { autogunAmmo } from '../../specs/items';
import { Laser } from './modules/laser';
import { Weapon } from './modules/weapon';
import { Projectile } from './projectile';
import { addEntity, entityId } from '../simulation/world';
import { applyForce } from '../physics/apply-force';
import { rotatePoint } from '../utilities/geometry';
import { game } from '../game';
import { shipSpecsById, type ShipId } from '../../specs/ships';
import { type ShipSpec } from '../../specs/ships/types';
import { flight } from '../../specs/control-ship';
import { holeSpec } from '../../specs/hole';
import { easeProgress } from '../utilities/ease';
import * as Vec from '../utilities/vector';
import { Craft, type CraftRenderOptions } from './craft';
import { movePoint } from '../utilities/geometry';
import { approach } from '../utilities/approach';
import { type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld } from '../simulation/world';
import { type Mount, type Segment } from '../types';
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
  | { action: 'buy'; module: number; moduleId?: number; mount?: number };

export class Ship extends Craft {
  declare name: string;
  // Resist collision torque without changing the pilot's steering response.
  static angularInertiaScale = flight.angularInertiaScale;
  kind = 'ship';
  firing = false;
  declare fuelCapacity: number;
  fuel: number;
  storedPower = 0;
  thrusterPower = 1;
  systemsPower = 1;

  get powerEntries() {
    return this.mounts.flatMap(({ module, health }) => {
      if (!module || health < 1) return [];
      const active =
        module.forwardThrust ||
        this.segments.some(
          (segment) => segment.module === module && segment.active,
        );

      return [
        {
          module,
          value:
            Number(
              active
                ? module.powerCharging &&
                  Math.max(module.chargeCooldown, module.fireCooldown) > 1e-9
                  ? module.powerCharging
                  : module.powerActivated
                : module.power,
            ) || 0,
        },
      ];
    });
  }

  get powerGeneration() {
    return this.powerEntries.reduce(
      (sum, { module }) => sum + (module.powerGenerated || 0),
      0,
    );
  }

  get powerCapacity() {
    return this.powerEntries.reduce(
      (sum, { module }) => sum + (module.powerCapacity || 0),
      0,
    );
  }

  get powerUsage() {
    return this.powerEntries.reduce((sum, { value }) => sum + value, 0);
  }

  modulePower(module: Module) {
    return module.forwardThrust ? 1 : this.systemsPower;
  }

  /**
   * Supply other modules first, then share spare generation and stored energy
   * among thrusters. MW integrated over seconds gives MJ of stored energy.
   */
  updatePower(dt: number) {
    if (!(dt > 0)) return;
    let generation = 0;
    let capacity = 0;
    let systems = 0;
    let thrusters = 0;

    this.powerEntries.forEach(({ module, value }) => {
      generation += module.powerGenerated || 0;
      capacity += module.powerCapacity || 0;

      if (module.forwardThrust) {
        thrusters += value;
      } else {
        systems += value;
      }
    });

    const stored = Math.max(0, Math.min(capacity, this.storedPower));
    const available = generation + stored / dt;

    this.systemsPower = systems > 0 ? Math.min(1, available / systems) : 1;
    this.thrusterPower =
      thrusters > 0
        ? Math.max(0, Math.min(1, (available - systems) / thrusters))
        : 1;
    const supplied =
      systems * this.systemsPower + thrusters * this.thrusterPower;

    this.storedPower = Math.max(
      0,
      Math.min(capacity, stored + (generation - supplied) * dt),
    );
    this.fly(this.forward || 0, this.turn || 0);
  }

  get lowFuel() {
    return this.fuel < this.fuelCapacity * flight.lowFuelThreshold;
  }

  get fuelThrottle() {
    return this.fuel <= 0 ? 0 : this.lowFuel ? flight.lowFuelSpeed : 1;
  }

  get refuelCost() {
    return Math.ceil((this.fuelCapacity - this.fuel) * flight.fuelPrice);
  }

  consumeFuel(dt: number) {
    if (!this.cockpit || this.dockedTo || this.dead) return;
    const usage =
      (this.engine.fuelUsage || 0) *
      this.thrusterPower *
      Math.max(this.forward || 0, Math.abs(this.turn || 0) / 2);
    const reserve = this.fuelCapacity * flight.lowFuelThreshold;
    const normal = Math.min(Math.max(0, this.fuel - reserve), usage * dt);

    this.fuel = Math.max(
      0,
      this.fuel - normal - (usage * dt - normal) * flight.lowFuelUsage,
    );
  }

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

    const station = this.world?.entities.get(this.dockedTo) as
      | Craft
      | undefined;

    if (action.action === 'refuel') {
      const cost = this.refuelCost;

      if (station?.kind !== 'station' || !(cost > 0) || player.credits < cost) {
        return;
      }

      player.credits -= cost;
      this.fuel = this.fuelCapacity;
    } else if (action.action === 'buyStock') {
      const ids = action.objectIds;
      const objects = ids.map((id) =>
        station?.cargoContents.find((object) => object.id === id),
      );
      const cost = objects.reduce(
        (sum, object) => sum + (object?.price || 0),
        0,
      );

      if (
        !station ||
        !ids.length ||
        new Set(ids).size !== ids.length ||
        objects.some((object) => !object) ||
        player.credits < cost ||
        this.cargoContents.length + ids.length > this.cargoSpace
      ) {
        return;
      }

      station.cargoContents = station.cargoContents.filter(
        (object) => !ids.includes(object.id),
      );
      this.cargoContents.push(...objects);
      player.credits -= cost;
    } else if (action.action === 'sell') {
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

      if (station?.cargoContents) {
        objectsToSell.forEach((object) => {
          // Keep the ID usable for immediate buyback until the server assigns
          // a station ID and acknowledges the sale.
          station.cargoContents.push(object);
        });
      }

      player.credits += objectsToSell.reduce(
        (total, object) => total + (object.price || 0),
        0,
      );
    } else if (action.action === 'buyAmmo') {
      const item = station?.cargoContents.find(
        (object) => object.item === autogunAmmo,
      );

      if (!item) return;
      return (
        this.applyDockAction(
          { action: 'buyStock', objectIds: [item.id] },
          player,
        ) && action
      );
    } else if (action.action === 'buy') {
      const Type = moduleTypes[action.module];
      const objects = [...this.modules, ...this.cargoContents];

      if (
        !Type ||
        player.credits < Type.price ||
        (action.mount !== undefined
          ? !mount || mount.module || !mount.fits.includes(Type)
          : this.cargoContents.length >= this.cargoSpace) ||
        objects.some((object) => object.id === action.moduleId)
      ) {
        return;
      }

      // Restored server IDs share the negative range with local allocations.
      const module = new Type({
        id: action.moduleId ?? Math.min(0, ...objects.map(({ id }) => id)) - 1,
      });

      player.credits -= Type.price;

      if (mount) {
        this.fit(module, mount);
      } else {
        this.cargoContents.push(module);
      }

      return { ...action, moduleId: module.id };
    } else if (action.action === 'equip') {
      const module = this.modules.find(({ id }) => id === action.moduleId);

      if (!mount || !module || !mount.fits.includes(module.constructor)) return;
      this.fit(module, mount);
    } else if (action.action === 'repairHull') {
      const index = action.hullIndex;
      const plan = this.hullSegments[index];
      const health = this.hullHealth;
      const cost = plan?.health - Math.floor(health[index]);

      if (!Number.isInteger(index) || !(cost > 0) || player.credits < cost) {
        return;
      }

      player.credits -= cost;
      health[index] = plan.health;
      this.hullHealth = health;
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

      if (module) {
        module.shades = shades;
      } else {
        this.shades = shades;
      }

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

    this.fuel = properties.fuel ?? spec.fuelCapacity;
    this.storedPower = properties.storedPower ?? 0;
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
        segment.active *=
          this.launchThrottle * this.fuelThrottle * this.thrusterPower;
      }
    });
  }

  get forwardThrust() {
    return (
      (this.engine.forwardThrust || 0) *
      this.launchThrottle ** 2 *
      this.fuelThrottle *
      this.thrusterPower
    );
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
    const drillTips = new Map<
      Segment,
      {
        contact: Contact;
        drillTip: Contact['collider'];
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

      const drillTip = own;

      if (
        !drillTip?.segment ||
        !(drillTip.segment.module instanceof HornDrill) ||
        !this.isDrillTip(drillTip)
      ) {
        return;
      }

      const target = drillTip === collider ? other : collider;
      const current = drillTips.get(drillTip.segment);

      if (!current || contact.depth > current.contact.depth) {
        drillTips.set(drillTip.segment, { contact, drillTip, target });
      }
    });

    drillTips.forEach(({ contact, drillTip, target }) => {
      (drillTip.segment!.module as HornDrill).drill({
        ship: this,
        segment: drillTip.segment!,
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
    const { ctx } = game;
    const pose = options.pose || this;
    const scaleDuration = holeSpec.transitScaleDuration / 1000;
    const scale =
      this.transitTime < 0
        ? Math.min(1, -this.transitTime / scaleDuration)
        : this.transitTime > 0
          ? Math.max(
              0,
              Math.min(
                1,
                (scaleDuration +
                  holeSpec.arrivalHoldDuration / 1000 -
                  this.transitTime) /
                  scaleDuration,
              ),
            )
          : 1;
    const eased = easeProgress(scale);

    if (eased < 1e-8) return;
    ctx.save();
    ctx.translate(pose.position.x, pose.position.y);
    ctx.scale(eased, eased);
    ctx.translate(-pose.position.x, -pose.position.y);

    super.render({
      ...options,
      drawHull: (options) => drawHullSegment({ ctx, ...options }),
    });

    ctx.restore();
  }

  repairCost(mount?: Mount) {
    if (!mount) return this.hullMaxHealth - (this.hullHealthTotal | 0);
    return mount.module
      ? (mount.module.health || mount.module.healthActivated) -
          ((mount.health ?? 0) | 0)
      : 0;
  }

  get rotationalThrust() {
    return (
      (this.engine.rotationalThrust || 0) *
      this.launchThrottle ** 2 *
      this.fuelThrottle *
      this.thrusterPower
    );
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
        if (module.ammo !== undefined) {
          const index = this.cargoContents.findIndex(
            (item) => item.resource === module.ammo.resource && item.rounds > 0,
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
    this.updatePower(dt);

    if (this.transitTime) {
      const portal = this.world?.entities.get(this.transitGate);

      if (portal) {
        const remaining =
          -this.transitTime - holeSpec.transitScaleDuration / 1000;
        const ratio =
          this.transitTime < 0 && remaining > dt ? dt / remaining : 1;

        Vec.addScaled(
          this.position,
          Vec.subtract(portal.position, this.position),
          ratio,
          this.position,
        );
      }

      Vec.setXY(this.velocity, 0, 0);
      this.spin = 0;
      this.fly(0, 0);
      this.updateModules(dt);

      if (this.transitTime < 0) {
        this.transitTime = Math.min(-1e-6, this.transitTime + dt);
      } else {
        this.transitTime = Math.max(0, this.transitTime - dt);
      }

      return;
    }

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

    const throttle = this.fuelThrottle;

    this.consumeFuel(dt);

    if (throttle !== this.fuelThrottle) this.fly(this.forward, this.turn);
    super.update(dt);
    this.fireWeapons(dt);
  }
}
