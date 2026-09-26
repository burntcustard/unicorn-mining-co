import { colors } from '../colors';
import { Module } from './module';
import { type Collider, type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld } from '../simulation/world';
import { type Ship } from '../craft/ship';
import { Item } from '../items/item';
import { type GameObject } from '../game-object';

const cargoHatchLength = 16;
const cargoHatchOpenAngle = 2.5;
const cargoHatchDoorWidth = 1.5;

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
  doorRadius: cargoHatchLength * 2,
  openingThreshold: 0.5,
  throatRadius: cargoHatchLength * 0.75,
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

import { type Mount, type ShapeOutline } from '../types';

// Cargo hatch
// A pair of doors hinged at their outer ends, lying flat inside the hull and
// swinging forwards to open a mouth in the side of the ship: | closed, < open.
// It sits far enough in that only the door on the outside of the ship swings
// clear of the hull, so the hatch reads the same on either side of it
// Far enough out that the doors are no longer a wall across the way in
export const cargoHatchOpen = cargoHatchGeometry.openingThreshold;

export class CargoHatch extends Module {
  static shades = colors.violet;
  static activationDuration = 0.7;
  static label = 'CARGO HATCH';
  static health = 4;
  static model: any[] = [
    {
      shapeOutline: [] as ShapeOutline,
      // A door, hinged at its outer end and swinging forward as the hatch
      // opens. A long thin rectangle, which is why it can be collided with
      points: ({
        activationProgress,
        mount,
      }: {
        activationProgress: number;
        mount: Mount;
      }) => {
        const side = Math.sign(mount.localPosition.y);

        return cargoHatchGeometry.doorShapeOutline({
          progress: activationProgress,
          side,
        });
      },
      radius: () => cargoHatchGeometry.doorRadius,
      // A loose door keeps this same solid presentation without a shape outline.
      wreckage: {},
    },
    {
      // A nonphysical contact at the mouth, checked against the item's centre.
      catches: true,
      wreckage: false,
      radius: () => cargoHatchGeometry.throatRadius,
    },
  ];
  static price = 150;
  static collectsCargo = true;
  static unhurtWhen = 0;
  static zIndex = -1;

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
}
