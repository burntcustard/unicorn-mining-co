// Build-time variants: release builds never import these experiments.
export function shapeExperiment(code, id, variant) {
  if (!['required-dt', 'tier-position', 'world-shape'].includes(variant)) {
    throw Error(`Unknown shape experiment: ${variant}`);
  }
  const replace = (before, after) => {
    if (!code.includes(before)) {
      throw Error(`Shape experiment marker missing: ${id}: ${before}`);
    }
    code = code.replace(before, after);
  };

  if (variant === 'required-dt') {
    if (id.endsWith('/src/shared/simulation/update-tier.ts')) {
      replace('  dt = simulationStep,', '  dt,');
      replace('  dt?: number;', '  dt: number;');
    }

    if (id.endsWith('/src/client/prediction.ts')) {
      replace(
        '        tick,\n      });',
        '        tick,\n        dt: simulationStep,\n      });',
      );
    }
  }

  if (variant === 'tier-position') {
    if (id.endsWith('/src/shared/simulation/update-tier.ts')) {
      replace('  entity,\n  observers,', '  position,\n  observers,');
      replace(
        "  entity: Pick<GameObject, 'position'>;",
        '  position: Vec.Value;',
      );
      replace(
        'Vec.distanceSquared(entity.position, observer.position)',
        'Vec.distanceSquared(position, observer.position)',
      );
      replace(
        'updateTier({ entity, observers })',
        'updateTier({ position: entity.position, observers })',
      );
    }

    if (id.endsWith('/src/server/replication.ts')) {
      replace(
        'updateTier({ entity, observers: [ship] })',
        'updateTier({ position: entity.position, observers: [ship] })',
      );
    }

    if (id.endsWith('/src/client/remote-motion.ts')) {
      replace('entity: { position },', 'position,');
    }
  }

  if (
    variant === 'world-shape' &&
    id.endsWith('/src/shared/simulation/world.ts')
  ) {
    replace(
      '  nextEntityId: 1,',
      '  movementParents: undefined,\n  nextEntityId: 1,',
    );
  }
  return code;
}
