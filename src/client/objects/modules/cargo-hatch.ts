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

export const cargoContactAllowed = (self: Collider, other: Collider) =>
  (self.pickupPoint === true && other.segment?.catches === true) ||
  (self.segment?.catches === true && other.pickupPoint === true);

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
    geometry = specification.cargoGeometry,
  }: {
    progress: number;
    side: number;
    geometry?: Extract<ModuleSpec, { behavior: 'cargoHatch' }>['cargoGeometry'];
  }) => {
    const angle = progress * geometry.openAngle;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const fromY = side * geometry.length;
    const toX = geometry.length * sine;
    const toY = side * geometry.length * (1 - cosine);
    const outX = -side * cosine * geometry.doorWidth;
    const outY = -sine * geometry.doorWidth;

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
    const geometry = spec.cargoGeometry;

    return super.createModel(spec).map((part, index) =>
      part.catches
        ? {
            ...part,
            wreckage: false,
            radius: () => geometry.throatRadius,
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
                side: geometry.paired
                  ? index === 0
                    ? -1
                    : 1
                  : Math.sign(mount.localPosition.y),
                geometry,
              }),
            radius: () => geometry.doorRadius,
            wreckage: { color: part.color, fillShade: part.fillShade },
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
      collider.segment?.module === this && collider.segment.catches
        ? collider
        : other.segment?.module === this && other.segment.catches
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
}

export const CargoHatch = CargoHatchModule.define('cargoHatch');
export const CargoHatchPair = CargoHatch.define('cargoHatchPair');
