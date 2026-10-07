import { CargoHatch, SearchLight, HornDrill } from './modules/index';
import { ShieldGeneratorModule } from './modules/shield-generator';
import { PlasmaAccelerator, Autogun } from './modules/weapon';
import { Ship } from './ship';
import { type PlayerInput } from '../protocol/input';
import { type SimulationEvent } from '../protocol/events';

type ModuleInputOptions = { input: PlayerInput; active: boolean };

export const moduleControls = [
  {
    Type: PlasmaAccelerator,
    input: 'plasmaActive',
    readInput: (input: PlayerInput) => !!input.plasmaActive,
    writeInput: ({ input, active }: ModuleInputOptions) => {
      input.plasmaActive = active;
    },
  },
  {
    Type: Autogun,
    input: 'autogunActive',
    readInput: (input: PlayerInput) => !!input.autogunActive,
    writeInput: ({ input, active }: ModuleInputOptions) => {
      input.autogunActive = active;
    },
  },
  {
    Type: CargoHatch,
    input: 'cargoHatch',
    readInput: (input: PlayerInput) => input.cargoHatch,
    writeInput: ({ input, active }: ModuleInputOptions) => {
      input.cargoHatch = active;
    },
  },
  {
    Type: SearchLight,
    input: 'searchLight',
    readInput: (input: PlayerInput) => input.searchLight,
    writeInput: ({ input, active }: ModuleInputOptions) => {
      input.searchLight = active;
    },
  },
  {
    Type: ShieldGeneratorModule,
    input: 'shieldGenerator',
    readInput: (input: PlayerInput) => input.shieldGenerator,
    writeInput: ({ input, active }: ModuleInputOptions) => {
      input.shieldGenerator = active;
    },
  },
  {
    Type: HornDrill,
    input: 'hornDrill',
    readInput: (input: PlayerInput) => input.hornDrill,
    writeInput: ({ input, active }: ModuleInputOptions) => {
      input.hornDrill = active;
    },
  },
] as const;

export const controlShip = (
  ship: Ship,
  input: PlayerInput,
  events: SimulationEvent[],
) => {
  ship.firing = !!input.fire;

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
      command !== 'plasmaActive' &&
      command !== 'autogunActive'
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
