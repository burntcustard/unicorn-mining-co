import { colors } from '../colors';
import { Module } from './module';
import { type Contact } from '../collision/types';
import { type SimulationEvent } from '../protocol/events';
import { type SimulationWorld } from '../simulation/world';
import { type Ship } from '../craft/ship';
import { Item } from '../items/item';

const scoopLength = 16;
const scoopOpenAngle = 2.5;
const scoopDoorWidth = 1.5;

export const cargoScoopGeometry = {
  doorRadius: scoopLength * 2,
  openingThreshold: 0.5,
  throatRadius: scoopLength * 0.75,
  doorOutline: ({ progress, side }: { progress: number; side: number }) => {
    const angle = progress * scoopOpenAngle;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const fromY = side * scoopLength;
    const toX = scoopLength * sine;
    const toY = side * scoopLength * (1 - cosine);
    const outX = -side * cosine * scoopDoorWidth;
    const outY = -sine * scoopDoorWidth;

    return [
      [outX, fromY + outY],
      [toX + outX, toY + outY],
      [toX - outX, toY - outY],
      [-outX, fromY - outY],
    ] as Outline;
  },
};

import { type Mount, type Outline } from '../types';

// Cargo scoop
// A pair of doors hinged at their outer ends, lying flat inside the hull and
// swinging forwards to open a mouth in the side of the ship: | closed, < open.
// It sits far enough in that only the door on the outside of the ship swings
// clear of the hull, so the scoop reads the same on either side of it
// Far enough out that the doors are no longer a wall across the way in
export const scoopOpen = cargoScoopGeometry.openingThreshold;

export class CargoScoop extends Module {
  static shades = colors.violet;
  static activationDuration = 0.7;
  static label = 'HATCH';
  static health = 4;
  static model: any[] = [
    {
      outline: [] as Outline,
      // A door, hinged at its outer end and swinging forward as the scoop
      // opens. A long thin rectangle, which is why it can be collided with
      points: ({
        activationProgress,
        mount,
      }: {
        activationProgress: number;
        mount: Mount;
      }) => {
        const side = Math.sign(mount.localPosition.y);

        return cargoScoopGeometry.doorOutline({
          progress: activationProgress,
          side,
        });
      },
      radius: () => cargoScoopGeometry.doorRadius,
      // A loose door keeps this same solid, outline-free presentation.
      debris: {},
    },
    {
      // A nonphysical contact at the mouth, checked against the item's centre.
      catches: true,
      debris: false,
      radius: () => cargoScoopGeometry.throatRadius,
    },
  ];
  static price = 150;
  static scoops = true;
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
      collider.segment?.module === this && collider.role === 'scoop'
        ? collider
        : other.segment?.module === this && other.role === 'scoop'
          ? other
          : undefined;

    if (!throat) return;
    const item = (throat === collider ? other : collider).owner;

    if (
      !(item instanceof Item) ||
      !(throat === collider ? other : collider).pickupPoint ||
      ship.playerId === undefined ||
      !ship.moduleActive({ module: CargoScoop }) ||
      !world.entities.has(item.id) ||
      ship.cargoContents.length >= ship.cargoSpace
    ) {
      return;
    }
    ship.cargoContents.push(item);
    item.remove();
    events.push({
      by: ship.playerId,
      itemId: item.id,
      resource: item.resource,
      type: 'itemCollected',
    });
  }
}
