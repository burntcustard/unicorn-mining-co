import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { stopOwnedChild } from '../../benchmarking/utilities/owned-child.ts';

class FakeChild extends ChildProcess {
  pid: number = 123;
  exitCode: number = null;
  signalCode: NodeJS.Signals = null;
  signals: (NodeJS.Signals | number)[] = [];
  exitOn: NodeJS.Signals = 'SIGTERM';

  kill(signal: NodeJS.Signals | number = 'SIGTERM') {
    this.signals.push(signal);

    if (signal === this.exitOn) {
      this.signalCode = this.exitOn;
      this.emit('exit', null, signal);
    }

    return true;
  }
}

const failedSpawn = new FakeChild();

failedSpawn.pid = undefined;
await stopOwnedChild({ child: failedSpawn });
assert.deepEqual(failedSpawn.signals, []);
assert.equal(failedSpawn.listenerCount('exit'), 0);

const alreadyStopped = new FakeChild();

alreadyStopped.signalCode = 'SIGTERM';
await stopOwnedChild({ child: alreadyStopped });
assert.deepEqual(alreadyStopped.signals, []);

const graceful = new FakeChild();

await stopOwnedChild({ child: graceful });
assert.deepEqual(graceful.signals, ['SIGTERM']);
assert.equal(graceful.listenerCount('exit'), 0);
assert.equal(graceful.listenerCount('close'), 0);

const forced = new FakeChild();

forced.exitOn = 'SIGKILL';
const first = stopOwnedChild({ child: forced, graceMs: 1, killMs: 1 });
const second = stopOwnedChild({ child: forced, graceMs: 1, killMs: 1 });

assert.equal(first, second, 'Concurrent cleanup shares one shutdown');
await first;
assert.deepEqual(forced.signals, ['SIGTERM', 'SIGKILL']);
assert.equal(forced.listenerCount('exit'), 0);
assert.equal(forced.listenerCount('close'), 0);

const unresponsive = new FakeChild();

unresponsive.exitOn = null;
await assert.rejects(
  stopOwnedChild({ child: unresponsive, graceMs: 1, killMs: 1 }),
  /did not exit after SIGKILL/,
);
assert.deepEqual(unresponsive.signals, ['SIGTERM', 'SIGKILL']);
assert.equal(unresponsive.listenerCount('exit'), 0);
assert.equal(unresponsive.listenerCount('close'), 0);
