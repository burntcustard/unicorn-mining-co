import * as Vec from '../vector';
import { Craft } from './craft';
import { movePoint } from '../geometry';
import { approach } from '../utilities/approach';
import { type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld } from '../simulation/world';
import { type Mount, type Segment } from '../types';
import { HornDrill } from '../modules/horn-drill';
import { CargoHatch } from '../modules/cargo-hatch';
import { moduleTypes } from '../modules';
import { Module } from '../modules/module';
import { Item } from '../items/item';
import { paintColors } from '../colors';
import { type CraftAction } from '../protocol/network';

type DockActionRequest =
  | Exclude<CraftAction, { action: 'buy' }>
  | { action: 'buy'; module: number; moduleId?: number };

const thrustScale = 220;
const steeringEase = 0.5;

export class Ship extends Craft {
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
  // Resist collision torque without changing the pilot's steering response.
  static angularInertiaScale = 1.5;
  kind = 'ship';

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

  repairCost(mount?: Mount) {
    if (!mount) return this.hullMaxHealth - (this.hullHealthTotal | 0);
    return mount.module ? mount.module.health - ((mount.health ?? 0) | 0) : 0;
  }

  /**
   * Apply one dock action to this ship. A local buy action gets its module ID
   * here; the server receives that ID and runs the same rules.
   */
  applyDockAction(action: DockActionRequest): CraftAction | undefined {
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
      this.credits += objectsToSell.reduce(
        (total, object) => total + (object.price || 0),
        0,
      );
    } else if (action.action === 'buy') {
      const Type = moduleTypes[action.module];

      if (
        !Type ||
        this.credits < Type.price ||
        this.cargoContents.length >= this.cargoSpace
      ) {
        return;
      }
      const module = new Type(
        action.moduleId === undefined ? {} : { id: action.moduleId },
      );

      this.credits -= Type.price;
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

        if (!(cost > 0) || this.credits < cost) return;
        this.credits -= cost;
        this.fixHull();
      } else {
        if (!mount?.module || mount.module.id !== action.moduleId) return;
        const cost = this.repairCost(mount);

        if (!(cost > 0) || this.credits < cost) return;
        this.credits -= cost;
        mount.health = mount.module.health;
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

  get thrust() {
    return this.forward || 0;
  }
  set thrust(value: number) {
    this.fly(value, this.turn || 0);
  }
  // Only a crewed ship flies: wreckage and stations have no cockpit to fly from
  get maxSpeed() {
    return (this.cockpit && 17 * this.forwardThrust) || 180;
  }

  // This hull has one engine mount; each nozzle belongs to the same module.
  get engine(): any {
    return (
      this.modules?.find(
        (module) =>
          module.forwardThrust && module.mount && !(module.mount.health < 1),
      ) || {}
    );
  }

  get forwardThrust() {
    return (this.engine.forwardThrust || 0) * this.launchThrottle ** 2;
  }

  get rotationalThrust() {
    return (this.engine.rotationalThrust || 0) * this.launchThrottle ** 2;
  }

  // Half-size nozzles retain the original quarter-thrust launch coast.
  // Return to full power for the last 0.05 seconds of launch.
  get launchThrottle() {
    return this.launching > 0.05 && this.launching <= 2 ? 0.5 : 1;
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
              : forward * steeringEase
            : forward;
        segment.active *= this.launchThrottle;
      }
    });
  }

  update(dt: number) {
    if (this.launching) {
      this.launching = Math.max(0, this.launching - dt);
      this.fly(this.forward, this.turn);
    }

    if (this.cockpit && !this.dockedTo) {
      const push =
        ((thrustScale * this.forwardThrust) / this.mass) * this.forward * dt;
      const rotationalThrust = this.rotationalThrust;
      const targetSpin =
        (this.turn *
          this.turnRate *
          rotationalThrust *
          this.launchThrottle ** 2) /
        16;

      this.spin = approach(this.spin, targetSpin, rotationalThrust * dt);
      Vec.set(
        this.velocity,
        movePoint(this.velocity, this.rotation + this.spin * dt, push),
      );
    }

    super.update(dt);
  }
}
