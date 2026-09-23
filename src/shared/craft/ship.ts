import { Craft } from './craft';
import { movePoint } from '../geometry';
import { approach } from '../utilities/approach';
import { type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld } from '../simulation/world';
import { type Segment } from '../types';
import { Asteroid } from '../simulation/asteroid';
import { Horn } from '../modules/horn';
import { CargoScoop } from '../modules/cargo-scoop';

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
    const drills = new Map<
      Segment,
      {
        contact: Contact;
        drill: Contact['collider'];
        rock: Contact['collider'];
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

      if (own?.segment?.module instanceof CargoScoop) {
        own.segment.module.collect({ ship: this, contact, events, world });
      }
      const drill = own;

      if (!drill?.segment || !(drill.segment.module instanceof Horn)) return;
      const rock = drill === collider ? other : collider;

      if (!(rock.owner instanceof Asteroid)) return;
      const current = drills.get(drill.segment);

      if (!current || contact.depth > current.contact.depth) {
        drills.set(drill.segment, { contact, drill, rock });
      }
    });
    drills.forEach(({ drill, rock }) => {
      (drill.segment!.module as Horn).mine({
        ship: this,
        segment: drill.segment!,
        asteroid: rock.owner as Asteroid,
        section: rock.part,
        position: drill.position,
        events,
        world,
        dt,
      });
    });
  }
  // Resist collision torque without changing the pilot's steering response.
  static angularInertiaScale = 1.5;
  kind = 'ship';
  get thrust() {
    return this.forward || 0;
  }
  set thrust(value: number) {
    this.fly(value, this.turn || 0);
  }
  // Only a crewed ship flies: debris and stations have no cockpit to fly from
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
      this.velocity.set(
        movePoint(this.velocity, this.rotation + this.spin * dt, push),
      );
    }

    super.update(dt);
  }
}
