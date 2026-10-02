// Build-time experiments only; no alternate arithmetic enters release builds.
const variants = [
  'baseline',
  'grid1000',
  'grid1024',
  'grid1000-smi',
  'position1000',
  'vector-double',
];

export function numericExperiment(code, id, variant) {
  if (!variants.includes(variant)) {
    throw Error(`Unknown numeric experiment: ${variant}`);
  }
  const replace = (before, after) => {
    if (!code.includes(before)) {
      throw Error(`Numeric experiment marker missing: ${id}: ${before}`);
    }
    code = code.replace(before, after);
  };

  if (variant === 'position1000' && id.endsWith('/src/shared/game-object.ts')) {
    replace(
      'round(this.position.x), round(this.position.y)',
      'Math.round(this.position.x * 1000) / 1000, Math.round(this.position.y * 1000) / 1000',
    );
  }

  if (variant === 'vector-double' && id.endsWith('/src/shared/vector.ts')) {
    replace(
      '({ x, y })',
      '{ const value = { x: NaN, y: NaN }; value.x = x; value.y = y; return value; }',
    );
  }

  if (variant.startsWith('grid')) {
    const scale = parseInt(variant.slice(4), 10);

    if (id.endsWith('/src/shared/collision/spatial-grid.ts')) {
      replace('const cellSize = 256;', `const cellSize = ${256 * scale};`);
      replace(
        'const aabbExtension = 10;',
        `const aabbExtension = ${10 * scale};`,
      );
      replace(
        'const aabbMultiplier = 2;',
        `const aabbMultiplier = ${2 * scale};
function setBounds(target: AABB, source: AABBValue) {
  target.lowerBound.x = Math.floor(source.lowerBound.x * ${scale});
  target.lowerBound.y = Math.floor(source.lowerBound.y * ${scale});
  target.upperBound.x = Math.ceil(source.upperBound.x * ${scale});
  target.upperBound.y = Math.ceil(source.upperBound.y * ${scale});
}`,
      );
      code = code.replaceAll(
        'node.aabb.set(box);',
        'setBounds(node.aabb, box);',
      );
      replace(
        'if (node.aabb.contains(box)) return false;',
        `if (node.aabb.lowerBound.x <= box.lowerBound.x * ${scale} &&
node.aabb.lowerBound.y <= box.lowerBound.y * ${scale} &&
node.aabb.upperBound.x >= box.upperBound.x * ${scale} &&
node.aabb.upperBound.y >= box.upperBound.y * ${scale}) return false;`,
      );
      code = code
        .replaceAll(
          'Math.min(0, displacement.x * aabbMultiplier)',
          'Math.min(0, Math.floor(displacement.x * aabbMultiplier))',
        )
        .replaceAll(
          'Math.min(0, displacement.y * aabbMultiplier)',
          'Math.min(0, Math.floor(displacement.y * aabbMultiplier))',
        )
        .replaceAll(
          'Math.max(0, displacement.x * aabbMultiplier)',
          'Math.max(0, Math.ceil(displacement.x * aabbMultiplier))',
        )
        .replaceAll(
          'Math.max(0, displacement.y * aabbMultiplier)',
          'Math.max(0, Math.ceil(displacement.y * aabbMultiplier))',
        );

      if (variant.endsWith('-smi')) {
        replace(
          'const cellSize',
          `class IntegerPoint { x = 0; y = 0; }
class IntegerBounds extends AABB {
  constructor() { super(); this.lowerBound = new IntegerPoint(); this.upperBound = new IntegerPoint(); }
}
const cellSize`,
        );
        code = code.replaceAll('new AABB()', 'new IntegerBounds()');
        replace(
          'Vec.setXY(bounds.lowerBound, Infinity, Infinity);',
          'const nodes = [...group.nodes]; if (nodes.length) bounds.set(nodes[0].aabb);',
        );
        replace('Vec.setXY(bounds.upperBound, -Infinity, -Infinity);', '');
        replace('[...group.nodes].forEach', 'nodes.forEach');
      } else {
        replace('Infinity, Infinity', '2147483647, 2147483647');
        replace('-Infinity, -Infinity', '-2147483648, -2147483648');
      }
    }

    if (id.endsWith('/src/shared/physics/fixture.ts')) {
      for (const bound of ['lowerBound', 'upperBound']) {
        for (const axis of ['x', 'y']) {
          replace(`fat.${bound}.${axis}`, `(fat.${bound}.${axis} / ${scale})`);
        }
      }
    }
  }
  return code;
}
