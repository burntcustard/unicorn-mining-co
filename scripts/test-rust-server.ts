import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function run(executable: string, args: string[], env = process.env) {
  const child = spawn(executable, args, { env, stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');

  if (code !== 0) {
    throw new Error(`${executable} exited with ${signal ?? code}`);
  }
}

const cargo = [
  '--locked',
  '--manifest-path',
  'src/server-rust/Cargo.toml',
  '--target-dir',
  'src/server-rust/target',
];
const examples = 'src/server-rust/target/debug/examples';

await run('npm', ['run', 'build:client']);
await run(process.execPath, [
  '--import',
  'tsx',
  'scripts/generate-example-modules.ts',
]);
await run(process.execPath, [
  '--import',
  'tsx',
  '--import',
  './tests/support/local-storage.ts',
  'tests/parity/generate-fixtures.ts',
]);
await run('cargo', ['test', ...cargo]);
await run('cargo', ['test', ...cargo, '--', '--ignored']);
await run('cargo', [
  'build',
  ...cargo,
  '--features',
  'test-fixtures',
  '--examples',
  '--bin',
  'unicorn-mining-server',
]);

await run(
  process.execPath,
  [
    'scripts/test.ts',
    '--skip-build',
    'tests/parity/flight-mode.test.ts',
    'tests/parity/gate-collisions.test.ts',
    'tests/parity/npc-ships.test.ts',
    'tests/parity/session.test.ts',
    'tests/parity/snapshot.test.ts',
    'tests/client/beam-visibility.test.ts',
    'tests/client/muzzle-flash.test.ts',
    'tests/client/projectile-prediction.test.ts',
    'tests/client/ship-destruction.test.ts',
    'tests/integration/live-world-maintenance.test.ts',
    'tests/integration/persistence-integration.test.ts',
    'tests/integration/server-integration.test.ts',
    'tests/integration/server-startup.test.ts',
    'tests/integration/trade-integration.test.ts',
  ],
  {
    ...process.env,
    TEST_SERVER_EXECUTABLE:
      'src/server-rust/target/debug/unicorn-mining-server',
    UNICORN_BEAM_VISIBILITY_FIXTURE: `${examples}/beam_visibility_fixture`,
    UNICORN_FLIGHT_MODE_FIXTURE: `${examples}/flight_mode_fixture`,
    UNICORN_GATE_COLLISIONS_FIXTURE: `${examples}/gate_collisions_fixture`,
    UNICORN_MUZZLE_FLASHES_FIXTURE: `${examples}/muzzle_flashes_fixture`,
    UNICORN_NPC_SHIPS_FIXTURE: `${examples}/npc_ships_fixture`,
    UNICORN_PROJECTILE_FIXTURE: `${examples}/projectile_prediction`,
    UNICORN_SESSION_FIXTURE: `${examples}/session_fixture`,
    UNICORN_SHIP_DESTRUCTION_FIXTURE: `${examples}/ship_destruction_fixture`,
    UNICORN_SNAPSHOT_FIXTURE: `${examples}/snapshot_fixture`,
    UNICORN_TRADE_FIXTURE: `${examples}/trade_fixture`,
  },
);
