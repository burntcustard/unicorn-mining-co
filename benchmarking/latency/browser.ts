import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import WebSocket from 'ws';
import type { parseLatencyOptions } from './options.ts';
import type { loadLatencyAssets } from './assets.ts';
import { stopOwnedChild } from '../utilities/owned-child.ts';
import { readBrowserJson } from '../utilities/browser-http.ts';

type BrowserReply = Record<string, any>;

type CommandOptions = { timeoutMs?: number; duringShutdown?: boolean };

export type LatencyPage = {
  evaluate: (expression: string, options?: CommandOptions) => Promise<any>;
  key: (type: 'keyDown' | 'keyUp', key: string) => Promise<void>;
  activate: () => Promise<void>;
  navigate: (url: string, options?: CommandOptions) => Promise<void>;
};

/*
 * Finish a probe frame after the real game's rAF callback returns, including
 * its presentFrame call. No extra frame callback, polling loop, or second
 * snapshot decoder runs on the page during a measured trial.
 */
const preload = `(() => {
  globalThis.__latencyRefs = [];
  globalThis.__latencyErrors = [];
  globalThis.__latencySockets = [];
  globalThis.__latencyAudio = [];
  if (globalThis.AudioContext) {
    const OriginalAudioContext = AudioContext;
    globalThis.AudioContext = class extends OriginalAudioContext {
      constructor(...args) { super(...args); __latencyAudio.push(this); }
    };
  }
  addEventListener('error', event => __latencyErrors.push(String(event.error?.stack || event.message)));
  addEventListener('unhandledrejection', event => __latencyErrors.push(String(event.reason?.stack || event.reason)));
  const raf = requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => raf.call(globalThis, now => {
    globalThis.__latencyFrameNow = now;
    const result = callback(now);
    globalThis.__latencyComplete?.(now);
    return result;
  });
  const OriginalSocket = WebSocket;
  globalThis.WebSocket = class extends OriginalSocket {
    constructor(...args) {
      super(...args);
      const entry = { url: String(args[0]), opened: false, closes: [], errors: 0 };
      __latencySockets.push(entry);
      this.addEventListener('open', () => { entry.opened = true; });
      this.addEventListener('close', event => entry.closes.push({ code: event.code, reason: event.reason, clean: event.wasClean }));
      this.addEventListener('error', () => entry.errors++);
    }
  };
})()`;

export const latencyBrowserPreload = (source = '') => source + ';\n' + preload;

export async function openLatencyBrowser({
  options,
  production,
  signal,
  registerClose,
  pageCount = 4,
  columns = 2,
  backgroundRendering = false,
  preloadSource = '',
}: {
  options: ReturnType<typeof parseLatencyOptions>;
  production: Awaited<ReturnType<typeof loadLatencyAssets>>;
  signal: AbortSignal;
  registerClose: (close: () => Promise<void>) => void;
  pageCount?: number;
  columns?: number;
  backgroundRendering?: boolean;
  preloadSource?: string;
}) {
  signal.throwIfAborted();
  const gameUrl = new URL(options.url);
  const profilePending = mkdtemp(join(tmpdir(), 'unicorn-latency-'));
  const sockets: WebSocket[] = [];
  let child: ReturnType<typeof spawn>;
  let closing: Promise<void>;

  const close = () =>
    (closing ??= (async () => {
      sockets.forEach((socket) => socket.terminate());

      try {
        await stopOwnedChild({ child });
      } finally {
        await rm(await profilePending, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    })());

  registerClose(close);

  try {
    const profile = await profilePending;

    signal.throwIfAborted();

    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();

      server.once('error', reject);

      server.listen(0, '127.0.0.1', () => {
        const address = server.address();

        assert(address && typeof address === 'object');
        server.close(() => resolve(address.port));
      });
    });

    const args = [
      '--no-first-run',
      '--no-default-browser-check',
      ...(backgroundRendering
        ? [
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
          ]
        : []),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${options.width + 24},${options.height + 120}`,
      'about:blank',
    ];

    signal.throwIfAborted();

    child = spawn(process.env.CHROME_BIN || 'google-chrome', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let logs = '';

    child.stderr?.on('data', (data) => {
      logs += data;
    });

    child.once('error', (error) => {
      logs += error.message;
    });

    const errors: string[] = [];
    const pages: LatencyPage[] = [];
    const intercepted = new Set<string>();
    const permissionOverrides: BrowserReply[] = [];
    const { networkPermission } = options;

    const connect = async (url: string) => {
      const socket = new WebSocket(url, { handshakeTimeout: 10000 });
      let closed = '';

      const connectionError = (method: string, cause?: Error) => {
        const exited = child.exitCode !== null || child.signalCode !== null;

        return Error(
          `Chrome control connection failed during ${method} (${new URL(url).pathname}, WebSocket state ${socket.readyState})${closed ? `: ${closed}` : ''}${cause ? `: ${cause.message}` : ''}${exited ? `; Chrome exited (${child.signalCode || child.exitCode})${logs ? `\n${logs.slice(-4000)}` : ''}` : ''}`,
          { cause },
        );
      };

      sockets.push(socket);

      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });

      let sequence = 0;

      const pending = new Map<
        number,
        {
          method: string;
          resolve: (reply: BrowserReply) => void;
          reject: (error: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >();

      const listeners = new Map<
        string,
        (params: BrowserReply) => Promise<void> | void
      >();

      socket.on('message', (data) => {
        const message = JSON.parse((data as Buffer).toString());
        const request = pending.get(message.id);

        if (!request) {
          void Promise.resolve()
            .then(() => listeners.get(message.method)?.(message.params))
            .catch((error) => errors.push(String(error.stack || error)));
          return;
        }

        pending.delete(message.id);
        clearTimeout(request.timer);

        if (message.error) {
          request.reject(Error(JSON.stringify(message)));
        } else {
          request.resolve(message.result);
        }
      });

      socket.on('close', (code, reason) => {
        closed = `closed with code ${code}${reason.length ? ` (${reason.toString()})` : ''}`;

        pending.forEach(({ method, reject, timer }) => {
          clearTimeout(timer);
          reject(connectionError(method));
        });

        pending.clear();
      });

      const send = (
        method: string,
        params: object = {},
        { timeoutMs = 30000, duringShutdown = false }: CommandOptions = {},
      ) =>
        new Promise<BrowserReply>((resolve, reject) => {
          if (!duringShutdown) signal.throwIfAborted();

          if (socket.readyState !== WebSocket.OPEN) {
            reject(connectionError(method));
            return;
          }

          const id = ++sequence;

          const timer = setTimeout(() => {
            pending.delete(id);
            reject(Error(`Timed out: ${method}`));
          }, timeoutMs);

          pending.set(id, { method, resolve, reject, timer });

          socket.send(JSON.stringify({ id, method, params }), (error) => {
            if (!error) return;
            pending.delete(id);
            clearTimeout(timer);
            reject(connectionError(method, error));
          });
        });

      return { send, listeners };
    };

    const asset = (url: string, document = false) => {
      const request = new URL(url);

      if (request.origin !== gameUrl.origin) return;
      const name =
        document || request.pathname === gameUrl.pathname
          ? 'index.html'
          : basename(request.pathname);
      const value = production.assets.get(name);

      if (value) intercepted.add(name);
      return value;
    };

    let endpoint = '';
    const startupEndsAt = performance.now() + 15000;

    while (performance.now() < startupEndsAt) {
      signal.throwIfAborted();

      try {
        endpoint = (
          await readBrowserJson({
            url: `http://127.0.0.1:${port}/json/version`,
            signal,
          })
        ).webSocketDebuggerUrl;
      } catch {
        /* Browser startup. */
      }

      if (endpoint) break;

      if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
        throw Error(logs || 'Owned browser exited during startup');
      }

      await pause(100);
    }

    assert(endpoint, `Browser startup exceeded 15 seconds: ${logs}`);
    const browser = await connect(endpoint);
    const version = await browser.send('Browser.getVersion');

    for (let index = 0; index < pageCount; index++) {
      const { browserContextId } = await browser.send(
        'Target.createBrowserContext',
      );

      if (networkPermission) {
        await browser.send('Browser.setPermission', {
          permission: { name: networkPermission },
          setting: 'granted',
          origin: gameUrl.origin,
          browserContextId,
        });

        permissionOverrides.push({
          client: index,
          name: networkPermission,
          origin: gameUrl.origin,
          scope: 'temporary-browser-context',
          state: 'granted',
        });
      }

      const { targetId } = await browser.send('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
        newWindow: true,
      });

      const targets = await readBrowserJson({
        url: `http://127.0.0.1:${port}/json`,
        signal,
        timeoutMs: 5000,
      });

      const client = await connect(
        targets.find((target: BrowserReply) => target.id === targetId)
          .webSocketDebuggerUrl,
      );
      const send = client.send;

      await send('Page.enable');
      await send('Runtime.enable');

      client.listeners.set('Page.javascriptDialogOpening', async (event) => {
        errors.push('Unexpected page dialog: ' + JSON.stringify(event));
        await send('Page.handleJavaScriptDialog', { accept: false });
      });

      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: latencyBrowserPreload(preloadSource),
      });

      const { windowId } = await browser.send('Browser.getWindowForTarget', {
        targetId,
      });

      await browser.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: (index % columns) * (options.width + 24),
          top: Math.floor(index / columns) * (options.height + 120),
          width: options.width + 24,
          height: options.height + 120,
          windowState: 'normal',
        },
      });

      await send('Emulation.setDeviceMetricsOverride', {
        width: options.width,
        height: options.height,
        deviceScaleFactor: 1,
        mobile: false,
      });

      client.listeners.set('Fetch.requestPaused', async (event) => {
        const value = asset(
          event.request.url,
          event.resourceType === 'Document',
        );

        if (!value) {
          await send('Fetch.continueRequest', { requestId: event.requestId });
          return;
        }

        await send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: value.contentType },
            { name: 'Cache-Control', value: 'no-store' },
          ],
          body: value.body.toString('base64'),
        });
      });

      await send('Fetch.enable', {
        patterns: [
          {
            urlPattern: gameUrl.origin + '/*',
            requestStage: 'Request',
          },
        ],
      });

      pages.push({
        evaluate: async (expression, command) => {
          const reply = await send(
            'Runtime.evaluate',
            {
              expression,
              awaitPromise: true,
              returnByValue: true,
            },
            command,
          );

          if (reply.exceptionDetails) {
            throw Error(
              reply.exceptionDetails.exception?.description ||
                JSON.stringify(reply.exceptionDetails),
            );
          }

          return reply.result.value;
        },
        key: async (type, key) => {
          await send('Input.dispatchKeyEvent', {
            type,
            key,
            code:
              key === ' '
                ? 'Space'
                : key === 'Shift'
                  ? 'ShiftLeft'
                  : key.length === 1
                    ? `Key${key.toUpperCase()}`
                    : key,
            ...(key === ' '
              ? { windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }
              : {}),
          });
        },
        activate: async () => {
          await send('Page.bringToFront');
        },
        navigate: async (url, command) => {
          await send('Page.navigate', { url }, command);
        },
      });

      await send('Page.navigate', { url: options.url });
    }

    return {
      pages,
      close,
      errors,
      metadata: {
        browser: 'chrome',
        version,
        permissionOverrides,
        launchArguments: args.map((arg) =>
          arg.startsWith('--user-data-dir=')
            ? '--user-data-dir=<temporary>'
            : arg,
        ),
        viewport: {
          width: options.width,
          height: options.height,
          deviceScaleFactor: 1,
        },
        interceptedAssets: () => [...intercepted],
        logs: () => logs,
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
