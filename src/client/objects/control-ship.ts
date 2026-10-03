import {
  CargoHatch,
  SearchLight,
  ShieldGenerator,
  HornDrill,
} from './modules/index';
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
  let running = 0;
  const segments = ship.segments;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];

    if (!segment.active || (segment.mount || segment).health < 1) continue;

    for (let control = 0; control < moduleControls.length; control++) {
      if (segment.module instanceof moduleControls[control].Type) {
        running |= 1 << control;
      }
    }
  }

  moduleControls.forEach(({ Type, input: command, readInput }, index) => {
    const enabled = readInput(input);

    if (!!(running & (1 << index)) === enabled) return;
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
