import {
  CargoHatch,
  SearchLight,
  ShieldGenerator,
  HornDrill,
} from '../modules';
import { Ship } from './ship';
import { type PlayerInput } from '../protocol/input';
import { type SimulationEvent } from '../protocol/events';

export const moduleControls = [
  {
    Type: CargoHatch,
    input: 'cargoHatch',
    readInput: (input: PlayerInput) => input.cargoHatch,
  },
  {
    Type: SearchLight,
    input: 'searchLight',
    readInput: (input: PlayerInput) => input.searchLight,
  },
  {
    Type: ShieldGenerator,
    input: 'shieldGenerator',
    readInput: (input: PlayerInput) => input.shieldGenerator,
  },
  {
    Type: HornDrill,
    input: 'hornDrill',
    readInput: (input: PlayerInput) => input.hornDrill,
  },
] as const;

export const controlShip = (
  ship: Ship,
  input: PlayerInput,
  events: SimulationEvent[],
) => {
  if (input.launch) ship.launch();
  ship.fly(
    ship.launching || input.launch ? 1 : Math.max(0, Math.min(1, input.thrust)),
    Math.max(-1, Math.min(1, input.turn)),
  );

  // One pass finds which controlled modules are running, as moduleActive does.
  const running = moduleControls.map(() => false);
  const segments = ship.segments;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];

    if (!segment.active || (segment.mount || segment).health < 1) continue;

    for (let control = 0; control < moduleControls.length; control++) {
      if (segment.module instanceof moduleControls[control].Type) {
        running[control] = true;
      }
    }
  }
  moduleControls.forEach(({ Type, input: command, readInput }, index) => {
    const enabled = readInput(input);

    if (running[index] === enabled) return;
    ship.setModuleActive({ module: Type, active: enabled });

    if (ship.playerId !== undefined && command !== 'hornDrill') {
      events.push({
        type: 'moduleChanged',
        module: command,
        active: enabled,
        playerId: ship.playerId,
      });
    }
  });
};
