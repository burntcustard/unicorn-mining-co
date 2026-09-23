import { CargoScoop, Light, Shield, Horn } from '../modules';
import { Ship } from './ship';
import { type PlayerInput } from '../protocol/input';
import { type SimulationEvent } from '../protocol/events';

export const moduleControls = [
  { Type: CargoScoop, input: 'hatch' },
  { Type: Light, input: 'light' },
  { Type: Shield, input: 'shield' },
  { Type: Horn, input: 'drill' },
] as const;

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

  for (const { Type, input: command } of moduleControls) {
    const enabled = input[command];

    if (ship.moduleActive({ module: Type }) === enabled) continue;
    ship.setModuleActive({ module: Type, active: enabled });

    if (ship.playerId !== undefined && command !== 'drill') {
      events.push({
        type: 'moduleChanged',
        module: command,
        active: enabled,
        playerId: ship.playerId,
      });
    }
  }
};
