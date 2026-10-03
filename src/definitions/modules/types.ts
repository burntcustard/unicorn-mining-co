type ModuleValues = {
  label: string;
  health: number;
  price: number;
  zIndex: number;
  shades?: readonly string[];
  activationDuration?: number;
  bounciness?: number;
  friction?: number;
  damage?: number;
  activationThreshold?: number;
  damageStepsPerSecond?: number;
  gripDecay?: number;
  gripScale?: number;
  disablePhysics?: boolean;
  forwardThrust?: number;
  rotationalThrust?: number;
  offset?: number;
  flareSizes?: readonly number[];
  nozzleSides?: readonly number[];
  collectsCargo?: boolean;
  grinds?: boolean;
  beam?: boolean;
  lens?: number;
  mouth?: number;
  reach?: number;
  spread?: number;
  corner?: number;
  shieldRadius?: number;
  coverDuration?: number;
  generatorRadius?: number;
  unhurtWhen?: number;
  drillTip?: { position: { x: number; y: number }; radius: number };
  points?: readonly (readonly number[])[];
  cargoGeometry?: {
    length: number;
    openAngle: number;
    doorWidth: number;
    doorRadius: number;
    openingThreshold: number;
    throatRadius: number;
  };
};

export type ModuleDefinition = ModuleValues &
  (
    | {
        behavior: 'thruster';
        forwardThrust: number;
        rotationalThrust: number;
        flareSizes: readonly number[];
        nozzleSides: readonly number[];
      }
    | {
        behavior: 'cargoHatch';
        cargoGeometry: NonNullable<ModuleValues['cargoGeometry']>;
      }
    | {
        behavior: 'searchLight';
        lens: number;
        mouth: number;
        reach: number;
        spread: number;
        corner: number;
      }
    | {
        behavior: 'hornDrill';
        damage: number;
        drillTip: NonNullable<ModuleValues['drillTip']>;
        points: readonly (readonly number[])[];
      }
    | {
        behavior: 'shieldGenerator';
        generatorRadius: number;
        shieldRadius: number;
        coverDuration: number;
      }
  );
