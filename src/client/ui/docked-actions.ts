import { type Ship } from '../objects/ship';
import { applyCraftAction } from '../network/craft-actions';

export const sendAppliedAction = (
  ship: Ship,
  action: Parameters<Ship['applyDockAction']>[0],
) => applyCraftAction(ship, action);

export const repairHullSegment = (ship: Ship, hullIndex: number) =>
  sendAppliedAction(ship, { action: 'repairHull', hullIndex });

export const buyAmmo = (ship: Ship) =>
  sendAppliedAction(ship, { action: 'buyAmmo' });

export const removeModule = (ship: Ship, mount: number) =>
  sendAppliedAction(ship, { action: 'remove', mount });

export const refuelShip = (ship: Ship) =>
  sendAppliedAction(ship, { action: 'refuel' });
