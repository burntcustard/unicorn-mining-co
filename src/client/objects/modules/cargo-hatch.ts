import { type Segment } from '../../types';
import { playSound } from '../../audio/sound-loader';
import { type ModuleSpec } from '../../../specs/modules/types';
import { moduleSpecs } from '../../../specs/modules/index';
import { Module, type ModuleRenderOptions } from './module';
import { type Collider, type Contact } from '../../collision/types';
import { type SimulationEvent } from '../../protocol/events';
import { type SimulationWorld } from '../../simulation/world';
import { type Ship } from '../ship';
import { Item } from '../item';
import { type GameObject } from '../game-object';

const specification = moduleSpecs.cargoHatch;
const cargoHatchLength = specification.cargoGeometry.length;
const cargoHatchOpenAngle = specification.cargoGeometry.openAngle;
const cargoHatchDoorWidth = specification.cargoGeometry.doorWidth;

export const cargoContactAllowed = (self: Collider, other: Collider) =>
  (self.pickupPoint === true && other.role === 'cargoHatch') ||
  (self.role === 'cargoHatch' && other.pickupPoint === true);

export const cargoPickupPoint = (item: GameObject): Collider => ({
  owner: item,
  position: item.position,
  radius: 0,
  rotation: item.rotation,
  physics: false,
  friction: item.friction,
  pickupPoint: true,
  contactFilter: cargoContactAllowed,
});

export const cargoHatchGeometry = {
  doorRadius: specification.cargoGeometry.doorRadius,
  openingThreshold: specification.cargoGeometry.openingThreshold,
  throatRadius: specification.cargoGeometry.throatRadius,
  doorShapeOutline: ({
    progress,
    side,
  }: {
    progress: number;
    side: number;
  }) => {
    const angle = progress * cargoHatchOpenAngle;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const fromY = side * cargoHatchLength;
    const toX = cargoHatchLength * sine;
    const toY = side * cargoHatchLength * (1 - cosine);
    const outX = -side * cosine * cargoHatchDoorWidth;
    const outY = -sine * cargoHatchDoorWidth;

    return [
      [outX, fromY + outY],
      [toX + outX, toY + outY],
      [toX - outX, toY - outY],
      [-outX, fromY - outY],
    ] as ShapeOutline;
  },
};

import { type Mount, type ShapeOutline } from '../../types';

// Cargo hatch
// A pair of doors hinged at their outer ends, lying flat inside the hull and
// swinging forwards to open a mouth in the side of the ship: | closed, < open.
// It sits far enough in that only the door on the outside of the ship swings
// clear of the hull, so the hatch reads the same on either side of it
// Far enough out that the doors are no longer a wall across the way in
export const cargoHatchOpen = cargoHatchGeometry.openingThreshold;

class CargoHatchModule extends Module {
  static createModel(spec: Extract<ModuleSpec, { behavior: 'cargoHatch' }>) {
    return super.createModel(spec).map((part) =>
      part.catches
        ? {
            ...part,
            wreckage: false,
            radius: () => cargoHatchGeometry.throatRadius,
          }
        : {
            ...part,
            // The door swings forward around its outer hinge.
            points: ({
              activationProgress,
              mount,
            }: {
              activationProgress: number;
              mount: Mount;
            }) =>
              cargoHatchGeometry.doorShapeOutline({
                progress: activationProgress,
                side: Math.sign(mount.localPosition.y),
              }),
            radius: () => cargoHatchGeometry.doorRadius,
            wreckage: { fillShade: part.fillShade },
          },
    );
  }

  collect({
    ship,
    contact,
    events,
    world,
  }: {
    ship: Ship;
    contact: Contact;
    events: SimulationEvent[];
    world: SimulationWorld;
  }) {
    const { collider, other } = contact;
    const throat =
      collider.segment?.module === this && collider.role === 'cargoHatch'
        ? collider
        : other.segment?.module === this && other.role === 'cargoHatch'
          ? other
          : undefined;

    if (!throat) return;
    const pickup = throat === collider ? other : collider;
    const item = pickup.owner;

    if (
      !(item instanceof Item) ||
      !cargoContactAllowed(throat, pickup) ||
      ship.playerId === undefined ||
      !ship.moduleActive({ module: CargoHatch }) ||
      !world.entities.has(item.id) ||
      (item.message === undefined &&
        ship.cargoContents.length >= ship.cargoSpace)
    ) {
      return;
    }

    if (item.message === undefined) ship.cargoContents.push(item);

    item.remove();

    events.push({
      by: ship.playerId,
      itemId: item.id,
      ...(item.message !== undefined && {
        message: item.message,
        unlock: item.unlock,
      }),
      resource: item.resource,
      type: 'itemCollected',
    });
  }

  render({ segment }: ModuleRenderOptions) {
    if (!segment.catches) super.render({ segment });
  }

  updateVisual({ segments }: { dt: number; segments: Segment[] }) {
    const active = Boolean(segments.some((segment) => segment.active));

    if (active !== Boolean(this.lastActive)) playSound(active ? 0 : 1);
    this.lastActive = active;
  }
}

export const CargoHatch = CargoHatchModule.define('cargoHatch');
