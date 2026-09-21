import { CargoScoop, Light, Shield, Horn } from '../modules';
import { Ship } from './ship';
import { type PlayerInput } from '../protocol/input';
import { type SimulationEvent } from '../protocol/events';

export const controlShip = (
  ship: Ship,
  input: PlayerInput,
  events: SimulationEvent[],
) => {
  if (input.launch) {
    ship.dockedTo = undefined;
    ship.launching = 3;
  }
  ship.fly(
    ship.launching || input.launch ? 1 : Math.max(0, Math.min(1, input.thrust)),
    Math.max(-1, Math.min(1, input.turn)),
  );

  for (const { Type, enabled, event } of [
    { Type: CargoScoop, enabled: input.hatch, event: 'hatch' as const },
    { Type: Light, enabled: input.light, event: 'light' as const },
    { Type: Shield, enabled: input.shield, event: 'shield' as const },
  ]) {
    if (ship.moduleActive({ module: Type }) === enabled) continue;
    ship.setModuleActive({ module: Type, active: enabled });
    if (ship.playerId !== undefined)
      events.push({
        type: 'moduleChanged',
        module: event,
        active: enabled,
        playerId: ship.playerId,
      });
  }
  ship.setModuleActive({ module: Horn, active: input.drill });
};
