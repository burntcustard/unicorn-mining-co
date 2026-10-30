import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * Exercise the real browser controller with fake Chrome and CDP transports.
 * Nothing launches a browser, listens on a port, or connects to the game.
 */
const loader = String.raw`
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';

const child = Object.assign(new EventEmitter(), {
  pid: 123, exitCode: null, signalCode: null, stderr: new EventEmitter(),
});
const state = { closedSends: 0, child };

class Socket extends EventEmitter {
  static OPEN = 1;
  readyState = 0;
  constructor(url) {
    super();
    this.page = url.endsWith('/page/test');
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open');
      if (this.page && process.env.CDP_FAILURE === 'already-closed') {
        this.readyState = 3;
        this.emit('close', 1001, Buffer.from('target gone'));
      }
    });
  }
  send(data, callback) {
    if (this.readyState !== 1) {
      state.closedSends++;
      throw new Error('Attempted send on a closed fake socket');
    }
    const { id, method } = JSON.parse(data);
    if (method === 'Page.enable') {
      if (process.env.CDP_FAILURE === 'process-exited') {
        child.exitCode = 23;
        child.stderr.emit('data', 'fatal test Chrome crash');
        callback(new Error('WebSocket is not open: readyState 3 (CLOSED)'));
      } else {
        this.readyState = 3;
        this.emit('close', 1006, Buffer.from('transport lost'));
      }
      return;
    }
    const result = {
      'Browser.getVersion': { product: 'test Chrome' },
      'Target.createBrowserContext': { browserContextId: 'context' },
      'Target.createTarget': { targetId: 'test' },
    }[method] || {};
    queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id, result }))));
    callback();
  }
  terminate() { this.readyState = 3; this.emit('close', 1000, Buffer.alloc(0)); }
}

globalThis.cdpConnectionTest = { ...state, Socket, state };

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'ws') return { url: 'test:cdp-socket', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    let source;
    if (url === 'test:cdp-socket') source = 'export default globalThis.cdpConnectionTest.Socket;';
    if (url === 'node:child_process') source = 'export const spawn = () => globalThis.cdpConnectionTest.child;';
    if (url === 'node:net') source = 'export const createServer = () => ({ once() {}, listen(port, host, done) { done(); }, address() { return {port:12345}; }, close(done) { done(); } });';
    if (url.endsWith('/benchmarking/utilities/owned-child.ts')) source = 'export async function stopOwnedChild() {}';
    if (url.endsWith('/benchmarking/utilities/browser-http.ts')) source = "export async function readBrowserJson({url}) { return url.endsWith('/json/version') ? {webSocketDebuggerUrl:'ws://127.0.0.1/devtools/browser/test'} : [{id:'test',webSocketDebuggerUrl:'ws://127.0.0.1/devtools/page/test'}]; }";
    return source === undefined ? next(url, context) : { format: 'module', source, shortCircuit: true };
  },
});
`;

const directory = mkdtempSync(join(tmpdir(), 'unicorn-cdp-connection-'));

try {
  const preload = join(directory, 'loader.ts');
  const probe = join(directory, 'probe.ts');

  writeFileSync(preload, loader);
  writeFileSync(
    probe,
    `import { openLatencyBrowser } from ${JSON.stringify(pathToFileURL(resolve('benchmarking/latency/browser.ts')).href)};
try {
  await openLatencyBrowser({
    options: {url:'http://localhost:3000/',width:640,height:480},
    production: {assets:new Map()}, signal:new AbortController().signal,
    registerClose() {}, pageCount:1,
  });
  throw Error('Expected the fake CDP transport to fail');
} catch (error) {
  console.log(JSON.stringify({message:error.message,cause:error.cause?.message,closedSends:globalThis.cdpConnectionTest.state.closedSends}));
}
`,
  );

  for (const failure of ['already-closed', 'pending-close', 'process-exited']) {
    const result = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(preload).href, probe],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, CDP_FAILURE: failure },
      },
    );

    assert.equal(result.status, 0, result.stderr || String(result.error));
    const error = JSON.parse(result.stdout);

    assert.match(error.message, /Chrome control connection.*Page.enable/);
    assert.match(error.message, /\/devtools\/page\/test/);
    assert.equal(error.closedSends, 0);

    if (failure === 'pending-close') {
      assert.match(error.message, /1006.*transport lost/);
    }

    if (failure === 'process-exited') {
      assert.match(error.message, /Chrome exited \(23\)/);
      assert.match(error.message, /fatal test Chrome crash/);
      assert.equal(error.cause, 'WebSocket is not open: readyState 3 (CLOSED)');
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
