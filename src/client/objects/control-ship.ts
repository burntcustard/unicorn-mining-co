import { CargoHatch, SearchLight, HornDrill } from './modules/index';
import { ShieldGeneratorModule } from './modules/shield-generator';
import { Weapon } from './modules/weapon';
import { Ship } from './ship';
import { type PlayerInput } from '../protocol/input';
import { type SimulationEvent } from '../protocol/events';

export const moduleControls = [
  {
    Type: Weapon,
    input: 'fire',
    readInput: (input: PlayerInput) => !!input.fire,
  },
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
    Type: ShieldGeneratorModule,
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

  moduleControls.forEach(({ Type, input: command, readInput }) => {
    const enabled = readInput(input);

    if (
      !ship.segments.some(
        (segment) =>
          segment.module instanceof Type &&
          !((segment.mount || segment).health < 1) &&
          Boolean(segment.active) !== enabled,
      )
    ) {
      return;
    }

    ship.setModuleActive({ module: Type, active: enabled });

    if (
      ship.playerId !== undefined &&
      command !== 'hornDrill' &&
      command !== 'fire'
    ) {
      events.push({
        type: 'moduleChanged',
        module: command,
        active: enabled,
        playerId: ship.playerId,
      });
    }
  });
};
