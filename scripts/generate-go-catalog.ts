import { jumpGateSpec, jumpGateHull } from '../src/specs/jump-gate';
import { wormholeSpec } from '../src/specs/wormhole';
import { portalSpec } from '../src/specs/portal';
import {
  sectorNames,
  sectorGeneration,
  startingSectorId,
} from '../src/specs/sectors';
import { moduleSpecForSimulation } from '../src/client/utilities/module-spec';
import { renderingLayers } from '../src/specs/rendering-layers';
import {
  defaultMass,
  defaultFriction as gameObjectFriction,
  defaultAngularInertiaScale,
} from '../src/specs/game-object';
import {
  defaultFriction as craftFriction,
  defaultHealth,
  hullBounciness,
  defaultActivationDuration,
  wreckageDecay,
  wreckageHealth,
} from '../src/specs/craft';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { colors, paintColors } from '../src/specs/colors';
import { pirateDialog } from '../src/specs/dialog/pirate';
import { pirateSpec } from '../src/specs/pirate';
import { npcMovement } from '../src/specs/npc-movement';
import { jumpGateDialog } from '../src/specs/dialog/jump-gate';
import { itemIds, itemSpecs } from '../src/specs/items/index';
import {
  moduleIds,
  moduleSpecs,
  stationModuleIds,
} from '../src/specs/modules/index';
import type { ModuleSpec } from '../src/specs/modules/types';
import { shipSpecs } from '../src/specs/ships/index';
import type { ShipSpec } from '../src/specs/ships/types';
import type { StationSpec } from '../src/specs/stations/types';
import { stationSpecs } from '../src/specs/stations/index';
import {
  binaryFieldIds,
  controlMessageIds,
  dockActionIds,
  entityKindIds,
} from '../src/specs/protocol';
import { itemDefaults } from '../src/specs/items/defaults';
import {
  physics,
  linearSlop,
  contactSpeedThreshold,
} from '../src/specs/physics';
import { motion } from '../src/specs/local-movement';
import { flight } from '../src/specs/control-ship';
import { simulationStep } from '../src/specs/simulation';
import { startingCredits } from '../src/specs/player';
import { updateTiers } from '../src/specs/update-tier';
import { maxCatchUpTicks } from '../src/specs/game-session';
import { maxPredictionTicks } from '../src/specs/prediction';
import {
  visibleRange,
  ballisticReplicateEvery,
  replication,
} from '../src/specs/replication';
import {
  regionSize,
  worldRanges,
  serverRegionRanges,
} from '../src/specs/region-manager';
import {
  preGeneratedRadius,
  regionGeneration,
} from '../src/specs/region-generation';

const simulation = {
  physics,
  linearSlop,
  contactSpeedThreshold,
  motion,
  flight,
  simulationStep,
  updateTiers,
  maxCatchUpTicks,
  maxPredictionTicks,
  visibleRange,
  ballisticReplicateEvery,
  replication,
  regionSize,
  worldRanges,
  serverRegionRanges,
  preGeneratedRadius,
};

const catalog = {
  npcMovement,
  pirateSpec,
  jumpGateDialog,
  pirateDialog,
  jumpGateSpec,
  wormholeSpec,
  portalSpec,
  jumpGateHull,
  sectorNames,
  sectorGeneration,
  startingSectorId,
  startingCredits,
  colors,
  paintColors,
  itemDefaults,
  itemIds,
  itemSpecs,
  moduleIds,
  stationModuleIds,
  moduleSpecs: Object.fromEntries(
    Object.entries(moduleSpecs).map(([id, spec]) => [
      id,
      {
        ...moduleSpecForSimulation(spec as ModuleSpec),
        ammo: (spec as ModuleSpec).ammo?.resource,
      },
    ]),
  ),
  shipSpecs,
  stationSpecs,
  protocol: { binaryFieldIds, controlMessageIds, dockActionIds, entityKindIds },
  simulation,
  regionGeneration,
};

const unique = (values: readonly (number | string)[]) =>
  new Set(values).size === values.length;

if (
  !unique(moduleIds) ||
  !unique(itemIds) ||
  !itemIds.every((id, index) => itemSpecs[id].resource === index) ||
  !moduleIds.every((id) => id in moduleSpecs) ||
  !Object.values(shipSpecs).every((ship: ShipSpec) => {
    const mounts = ship.hullSegments.flatMap((segment) => segment.mounts ?? []);

    return (
      unique(ship.initialLoadout.map((entry) => entry.mount)) &&
      ship.initialLoadout.every(
        ({ mount, module }) =>
          Number.isInteger(mount) &&
          mounts[mount]?.some((point) => point.fits.includes(module)),
      )
    );
  }) ||
  ![...Object.values(shipSpecs), ...Object.values(stationSpecs)].every(
    (craft: ShipSpec | StationSpec) =>
      craft.hullSegments.every(
        (segment) =>
          !('mounts' in segment) ||
          segment.mounts?.every((mount) =>
            mount.every((point) => point.fits.every((id) => id in moduleSpecs)),
          ),
      ),
  ) ||
  !unique(Object.values(binaryFieldIds)) ||
  Object.values(binaryFieldIds).some(
    (value) => !Number.isInteger(value) || value < 1,
  ) ||
  ![controlMessageIds, dockActionIds, entityKindIds].every((ids) =>
    unique(Object.values(ids)),
  )
) {
  throw new Error('Invalid spec IDs or mount references');
}

const json = JSON.stringify(catalog);

const numericConstants = {
  GameObjectMass: defaultMass,
  GameObjectFriction: gameObjectFriction,
  GameObjectAngularInertiaScale: defaultAngularInertiaScale,
  CraftFriction: craftFriction,
  CraftHealth: defaultHealth,
  HullZIndex: renderingLayers.shipHull,
  HullBounciness: hullBounciness,
  DefaultActivationDuration: defaultActivationDuration,
  WreckageDecay: wreckageDecay,
  WreckageHealth: wreckageHealth,
  LinearSlop: linearSlop,
  ContactSpeedThreshold: contactSpeedThreshold,
  AabbExtension: physics.aabbExtension,
  AabbMultiplier: physics.aabbMultiplier,
  MaxTranslation: physics.maxTranslation,
  MaxRotation: physics.maxRotation,
  MaxLinearCorrection: physics.maxLinearCorrection,
  PositionBaumgarte: physics.positionBaumgarte,
};

const constants = Object.entries(numericConstants)
  .map(([name, value]) => `const ${name} = ${value}`)
  .join('\n');
const digest = createHash('sha256')
  .update(json)
  .update(constants)
  .digest('hex');
const source = `// Code generated by scripts/generate-go-catalog.ts; DO NOT EDIT.\n// SHA-256: ${digest}\npackage specs\n\nconst catalogJSON = ${JSON.stringify(json)}\n\n${constants}\n`;

writeFileSync('src/server/specs/catalog_gen.go', source);
