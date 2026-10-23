import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginProtocolCoreSetup,
  finishInterruptedProtocolCapture,
} from '../../benchmarking/server/run.ts';

test('interruption waits for PID discovery and restores the resulting core limit', async () => {
  const actions: string[] = [];
  let foundPid: (pid: number) => void;

  const discovery = new Promise<number>((resolve) => {
    foundPid = resolve;
  });

  const setup = beginProtocolCoreSetup({
    findPid: () => {
      actions.push('discover');
      return discovery;
    },
    limit: async (pid) => {
      assert.equal(pid, 123);
      actions.push('limit');

      return {
        restore: async () => {
          actions.push('restore');
        },
      };
    },
  });

  const interrupted = finishInterruptedProtocolCapture({
    workers: [],
    restore: async () => {
      await (await setup).restore();
    },
    removeDirectory: async () => {
      actions.push('remove');
    },
    save: async () => {
      actions.push('save');
    },
    report: { cleanupErrors: [] },
  });

  await Promise.resolve();
  assert.deepEqual(actions, ['discover']);
  foundPid!(123);
  await interrupted;
  assert.deepEqual(actions, ['discover', 'limit', 'restore', 'remove', 'save']);
});

test('a rejected worker close cannot skip affinity restoration or the partial report', async () => {
  const actions: string[] = [];
  const report = { cleanupErrors: [] as string[] };
  let saved: string[];

  await finishInterruptedProtocolCapture({
    workers: [
      {
        close: async () => {
          actions.push('worker0');
          throw new Error('owned child did not exit after SIGKILL');
        },
      },
      {
        close: async () => {
          await Promise.resolve();
          actions.push('worker1');
        },
      },
    ],
    restore: async () => {
      assert.deepEqual(actions, ['worker0', 'worker1']);
      actions.push('restore');
    },
    removeDirectory: async () => {
      actions.push('remove');
    },
    save: async () => {
      actions.push('save');
      saved = [...report.cleanupErrors];
    },
    report,
  });

  assert.deepEqual(actions, [
    'worker0',
    'worker1',
    'restore',
    'remove',
    'save',
  ]);
  assert.deepEqual(saved!, [
    'protocol worker 0: owned child did not exit after SIGKILL',
  ]);
});

test('restoration and directory failures are retained without skipping remaining cleanup', async () => {
  const actions: string[] = [];
  const report = { cleanupErrors: [] as string[] };

  await assert.rejects(
    finishInterruptedProtocolCapture({
      workers: [],
      restore: async () => {
        actions.push('restore');
        throw new Error('server was replaced');
      },
      removeDirectory: async () => {
        actions.push('remove');
        throw new Error('directory is busy');
      },
      save: async () => {
        actions.push('save');
        assert.deepEqual(report.cleanupErrors, [
          'restore server affinity: server was replaced',
          'remove protocol temporary directory: directory is busy',
        ]);
        throw new Error('output is unwritable');
      },
      report,
    }),
    /output is unwritable/,
  );

  assert.deepEqual(actions, ['restore', 'remove', 'save']);
});
