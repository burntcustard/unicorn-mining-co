import { type GameObject } from './game-object';
import { type Module } from './modules/module';
import { type Mount, type Segment, type ShapeOutline } from '../types';
import { type MountPointSpec } from '../../specs/mounts';
import { renderingLayers } from '../../specs/rendering-layers';
import { defaultActivationDuration } from '../../specs/craft';
import { shapeOf } from '../utilities/geometry';
import * as Vec from '../utilities/vector';

export type HullSegmentPlan = Omit<Partial<Segment>, 'mounts'> & {
  [key: string]: any;
  health?: number;
  mounts?: MountPointSpec[][];
  points?: ShapeOutline | ((segment: Segment) => ShapeOutline);
};

export const lockedOutlines = new WeakSet<ShapeOutline>();

export const makeSegment = (
  craft: GameObject,
  craftModule: Module | HullSegmentPlan,
  segmentPlan: HullSegmentPlan,
  mount?: Mount,
): Segment => {
  const { points } = segmentPlan;
  const fixedPoints = Array.isArray(points) ? points : undefined;
  const shape = fixedPoints?.[0] && shapeOf(fixedPoints, mount);
  const thrusterOffset = segmentPlan.thrusterNozzleSide
    ? (mount?.mountPoints?.find(({ fits }) =>
        fits.includes(craftModule.constructor as typeof Module),
      )?.thrusterOffset ?? 0)
    : 0;

  // Model vertices are shared specs. Edge markings remain mutable;
  // changed geometry supplies another outline, including animated models.
  if (fixedPoints && !lockedOutlines.has(fixedPoints)) {
    fixedPoints.edges ||= fixedPoints.map(() => true);
    fixedPoints.forEach(Object.freeze);
    Object.freeze(fixedPoints);
    lockedOutlines.add(fixedPoints);
  }

  // A thruster's flare is up about as soon as the key is down, unless told
  // otherwise, either on the module itself or (as the shield's bubble does)
  // on just the one segment of it
  const duration =
    segmentPlan.activationDuration ||
    craftModule.activationDuration ||
    defaultActivationDuration;

  // Give hulls and modules the same runtime layout. Blueprint values are
  // copied once instead of making every blueprint a different prototype.
  return Object.assign(
    {
      health: undefined,
      points: undefined,
      mounts: undefined,
      core: undefined,
      disablePhysics: undefined,
      dockSegment: undefined,
      activationDuration: undefined,
      covers: undefined,
      fillAlpha: undefined,
      fillShade: undefined,
      color: undefined,
      wreckageColor: undefined,
      shapeOutline: undefined,
      wreckage: undefined,
      catches: undefined,
      flareSize: undefined,
      thrusterNozzleSide: undefined,
      facing: undefined,
      middle: undefined,
      reach: undefined,
      biting: undefined,
      collider: undefined,
      expandingTick: undefined,
      phase: 0,
      activationProgress: 0,
      hull: false,
      module: undefined,
      mount: undefined,
      active: 0,
      radius: undefined,
      rate: 0,
      shades: undefined,
      localPosition: undefined,
      zIndex: renderingLayers.shipHull,
    },
    segmentPlan,
    {
      phase: 0,
      ...shape,
      activationProgress: 0,
      hull: !mount,
      module: craftModule,
      mount,
      active: 0,
      radius: segmentPlan.radius || (shape && (() => shape.reach)),
      rate: 1 / duration,
      shades: craftModule.shades || craft.shades,
      localPosition: Vec.add(
        mount?.localPosition || segmentPlan.localPosition || Vec.create(),
        Vec.create(
          0,
          (segmentPlan.thrusterNozzleSide ||
            (craftModule.collectsCargo && mount
              ? -Math.sign(mount.localPosition.y)
              : 0)) *
            ((craftModule.offset || 0) + thrusterOffset),
        ),
      ),
      zIndex:
        segmentPlan.zIndex ??
        craftModule.zIndex ??
        craft.zIndex ??
        renderingLayers.shipHull,
    },
  ) as Segment;
};
