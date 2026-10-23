import type { ChildProcess } from 'node:child_process';

type OwnedChild = Pick<
  ChildProcess,
  'pid' | 'exitCode' | 'signalCode' | 'once' | 'off' | 'kill'
>;

const pending = new WeakMap<OwnedChild, Promise<void>>();

/*
 * Stop only a process started by this runner. Failed spawns never emit exit,
 * and a browser that ignores TERM must not prevent cleanup from finishing.
 */
export function stopOwnedChild({
  child,
  graceMs = 3000,
  killMs = 1000,
}: {
  child?: OwnedChild;
  graceMs?: number;
  killMs?: number;
}): Promise<void> {
  if (!child) return Promise.resolve();
  const previous = pending.get(child);

  if (previous) return previous;
  const stopped = () =>
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null;

  const waitForExit = (signal: NodeJS.Signals, milliseconds: number) =>
    new Promise<boolean>((resolve, reject) => {
      if (stopped()) {
        resolve(true);
        return;
      }

      const finish = () => {
        clearTimeout(timer);
        child.off('exit', finish);
        child.off('close', finish);
        resolve(true);
      };

      const timer = setTimeout(() => {
        child.off('exit', finish);
        child.off('close', finish);
        resolve(stopped());
      }, milliseconds);

      child.once('exit', finish);
      child.once('close', finish);

      try {
        child.kill(signal);
      } catch (error) {
        clearTimeout(timer);
        child.off('exit', finish);
        child.off('close', finish);
        reject(error);
      }
    });

  const shutdown = (async () => {
    if (await waitForExit('SIGTERM', graceMs)) return;

    if (!(await waitForExit('SIGKILL', killMs))) {
      throw new Error('The owned child did not exit after SIGKILL');
    }
  })();

  pending.set(child, shutdown);
  return shutdown;
}
