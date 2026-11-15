import { flight } from '../../../specs/control-ship';
import { simulationStep } from '../../../specs/simulation';
import type { Ship } from '../../objects/ship';
import type { Module } from '../../objects/modules/module';

export const shipStats = (ship: Ship, candidate?: Module | typeof Module) => {
  const mass = ship.mass + (candidate?.mass || 0);
  const working = Boolean(
    candidate && (candidate.health || candidate.healthActivated) >= 1,
  );
  const powerCapacity =
    ship.powerCapacity + (working ? candidate?.powerCapacity || 0 : 0);
  const entries = ship.powerEntries;
  const generation = entries.reduce(
    (sum, { module }) => sum + (module.powerGenerated || 0),
    working ? candidate?.powerGenerated || 0 : 0,
  );
  const systems = entries.reduce(
    (sum, { module, value }) => sum + (module.forwardThrust ? 0 : value),
    working && !candidate?.forwardThrust ? candidate?.power || 0 : 0,
  );
  const thrusters = entries.reduce(
    (sum, { module, value }) => sum + (module.forwardThrust ? value : 0),
    working && candidate?.forwardThrust ? (candidate.powerActivated ?? 0) : 0,
  );
  const available =
    generation +
    Math.max(0, Math.min(powerCapacity, ship.storedPower)) / simulationStep;
  const thrusterPower = candidate
    ? thrusters > 0
      ? Math.max(0, Math.min(1, (available - systems) / thrusters))
      : 1
    : ship.thrusterPower;
  const scale = ship.thrusterMountCount
    ? (ship.launchThrottle ** 2 * ship.fuelThrottle * thrusterPower) /
      ship.thrusterMountCount
    : 0;
  const forward =
    (ship.rawForwardThrust + (working ? candidate?.forwardThrust || 0 : 0)) *
    scale;
  const rotational =
    (ship.rawRotationalThrust +
      (working && candidate?.forwardThrust
        ? candidate.rotationalThrust || 0
        : 0)) *
    scale;

  return {
    mass,
    powerCapacity,
    acceleration: ship.cockpit ? (flight.thrustScale * forward) / mass : 0,
    maxSpeed:
      (ship.cockpit && flight.speedPerThrust * forward) ||
      flight.uncrewedMaxSpeed,
    turnRate: ship.cockpit
      ? (ship.turnRate *
          rotational *
          ship.angularThrust *
          ship.launchThrottle ** 2 *
          180) /
        (mass * flight.spinDivisor * Math.PI)
      : 0,
  };
};
