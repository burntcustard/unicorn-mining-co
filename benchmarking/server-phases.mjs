// Build-time instrumentation only. Nested phases charge elapsed time exclusively.
export const phaseRuntime = `
const totals = {};
let frame;
export function measure(label, run) {
  const parent = frame;
  const current = frame = { child: 0 };
  const start = performance.now();
  try { return run(); } finally {
    const elapsed = performance.now() - start;
    totals[label] = (totals[label] || 0) + elapsed - current.child;
    frame = parent;
    if (parent) parent.child += elapsed;
  }
}
export function resetPhases() { for (const key in totals) delete totals[key]; }
export function readPhases() { return totals; }
`;

export function instrumentPhases(code, id, detail = false) {
  const methods = [
    [
      'shared/game-object.ts',
      'GameObject',
      'update',
      'Base movement integration',
    ],
    ['shared/craft/craft.ts', 'Craft', 'updateModules', 'Module activation'],
    ['server/game-session.ts', 'GameSession', 'tick', 'Session bookkeeping'],
    ['server/game-session.ts', 'GameSession', 'receive', 'Input handling'],
    [
      'server/region-manager.ts',
      'RegionManager',
      'sync',
      'Region entity lifecycle',
    ],
    [
      'shared/simulation/region-manager.ts',
      'RegionManager',
      'queryMany',
      'Region queries',
    ],
    [
      'server/replication.ts',
      'ReplicationManager',
      'snapshot',
      'Snapshot preparation and deltas',
    ],
    [
      'server/replication.ts',
      'SnapshotEncoder',
      'encodeSnapshot',
      'Packet JSON encoding',
    ],
    [
      'shared/collision/game-collisions.ts',
      'GameCollisions',
      'step',
      'Collision and physics',
    ],
  ];

  if (detail) {
    methods.push(
      [
        'shared/collision/game-collisions.ts',
        'GameCollisions',
        'sync',
        'Fixture geometry synchronization',
      ],
      ['shared/physics/world.ts', 'World', 'step', 'Physics bookkeeping'],
      [
        'shared/physics/world.ts',
        'World',
        'findNewContacts',
        'Broadphase contact discovery',
      ],
      [
        'shared/physics/world.ts',
        'World',
        'updateContacts',
        'Existing contact detection',
      ],
      [
        'shared/physics/solver.ts',
        'Solver',
        'solveWorld',
        'Discrete physics solving',
      ],
      [
        'shared/physics/solver.ts',
        'Solver',
        'solveWorldTOI',
        'Continuous physics solving',
      ],
    );
  }
  const functions = [
    [
      'shared/simulation/local-movement.ts',
      'localMovement',
      'Local carrier motion',
    ],
    ['server/replication.ts', 'replicateEntity', 'Snapshot extraction'],
    [
      'server/parse-client-message.ts',
      'parseClientMessage',
      'Input decoding and validation',
    ],
    [
      'shared/simulation/update-world.ts',
      'updateWorld',
      'World bookkeeping and contact gameplay',
    ],
    [
      'shared/simulation/update-tier.ts',
      'updateEntities',
      'Entity movement and updates',
    ],
    [
      'shared/simulation/region-generation.ts',
      'generateRegion',
      'Procedural generation',
    ],
    [
      'shared/simulation/region-generation.ts',
      'generateStations',
      'Procedural generation',
    ],
  ];
  let changed = false;

  for (const [file, owner, method, label] of methods) {
    if (!id.endsWith('/' + file)) continue;

    if (
      owner === 'SnapshotEncoder' &&
      !code.includes('class SnapshotEncoder')
    ) {
      continue;
    }

    if (!detail && ['update', 'updateModules'].includes(method)) continue;
    code += `\n{const original = ${owner}.prototype.${method}; ${owner}.prototype.${method} = function(...args) {return measure('${label}', () => original.apply(this, args));};}`;
    changed = true;
  }

  for (const [file, name, label] of functions) {
    if (!id.endsWith('/' + file)) continue;

    if (!detail && ['replicateEntity', 'localMovement'].includes(name)) {
      continue;
    }
    const exported = code.includes(`export const ${name} =`);
    const marker = `${exported ? 'export ' : ''}const ${name} =`;

    if (!code.includes(marker)) throw new Error(`Missing phase marker ${name}`);
    code = code.replace(marker, `const measured${name} =`);
    code += `\n${exported ? 'export ' : ''}const ${name} = (...args) => measure('${label}', () => measured${name}(...args));`;
    changed = true;
  }

  if (id.endsWith('/server/game-session.ts')) {
    code = code.replace(
      'JSON.stringify(message)',
      "measure('Packet JSON encoding', () => JSON.stringify(message))",
    );
  }
  return changed
    ? `import {measure} from 'flight-native';\n${code}`
    : undefined;
}
