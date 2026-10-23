import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import WebSocket from 'ws';
import type { parseLatencyOptions } from './options.ts';
import type { loadLatencyAssets } from './assets.ts';
import { latencyNetworkPermission } from './permissions.ts';
import { stopOwnedChild } from '../utilities/owned-child.ts';

export type BrowserReply = Record<string, any>;

type CommandOptions = { timeoutMs?: number; duringShutdown?: boolean };

export type LatencyPage = {
  evaluate: (expression: string, options?: CommandOptions) => Promise<any>;
  key: (type: 'keyDown' | 'keyUp', key: string) => Promise<void>;
  activate: () => Promise<void>;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export async function openLatencyBrowser({
  options,
  production,
  signal,
  registerClose,
}: {
  options: ReturnType<typeof parseLatencyOptions>;
  production: Awaited<ReturnType<typeof loadLatencyAssets>>;
  signal: AbortSignal;
  registerClose: (close: () => Promise<void>) => void;
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

    const args =
      options.browser === 'chrome'
        ? [
            '--no-first-run',
            '--no-default-browser-check',
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${profile}`,
            `--window-size=${options.width + 24},${options.height + 120}`,
            'about:blank',
          ]
        : [
            '--new-instance',
            '--profile',
            profile,
            `--remote-debugging-port=${port}`,
            `--width=${options.width + 24}`,
            `--height=${options.height + 120}`,
            'about:blank',
          ];

    signal.throwIfAborted();
    child = spawn(
      options.browser === 'chrome'
        ? process.env.CHROME_BIN || 'google-chrome'
        : process.env.FIREFOX_BIN || 'firefox',
      args,
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
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
    const networkPermission = latencyNetworkPermission(options.url);

    const connect = async (url: string) => {
      const socket = new WebSocket(url, { handshakeTimeout: 10000 });

      sockets.push(socket);

      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });

      let sequence = 0;

      const pending = new Map<
        number,
        {
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

        if (message.error || message.type === 'error') {
          request.reject(Error(JSON.stringify(message)));
        } else {
          request.resolve(message.result);
        }
      });

      socket.on('close', () => {
        pending.forEach(({ reject, timer }) => {
          clearTimeout(timer);
          reject(Error('Owned browser connection closed'));
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
          const id = ++sequence;

          const timer = setTimeout(() => {
            pending.delete(id);
            reject(Error(`Timed out: ${method}`));
          }, timeoutMs);

          pending.set(id, { resolve, reject, timer });

          socket.send(JSON.stringify({ id, method, params }), (error) => {
            if (!error) return;
            pending.delete(id);
            clearTimeout(timer);
            reject(error);
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

      if (
        options.browser === 'firefox' &&
        logs.includes('WebDriver BiDi listening')
      ) {
        endpoint = `ws://127.0.0.1:${port}/session`;
      }

      if (options.browser === 'chrome') {
        try {
          endpoint = (
            await (
              await fetch(`http://127.0.0.1:${port}/json/version`, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
              })
            ).json()
          ).webSocketDebuggerUrl;
        } catch {
          /* Browser startup. */
        }
      }

      if (endpoint) break;

      if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
        throw Error(logs || 'Owned browser exited during startup');
      }

      await pause(100);
    }

    assert(endpoint, `Browser startup exceeded 15 seconds: ${logs}`);
    const browser = await connect(endpoint);
    let version: BrowserReply;

    if (options.browser === 'firefox') {
      version = await browser.send('session.new', {
        capabilities: { alwaysMatch: {} },
      });

      await browser.send('session.subscribe', {
        events: ['network.beforeRequestSent'],
      });

      // W3C WebDriver BiDi network interception: a full response preserves URL/origin.
      browser.listeners.set('network.beforeRequestSent', async (event) => {
        if (!event.isBlocked) return;
        const value = asset(
          event.request.url,
          event.request.destination === 'document',
        );

        if (!value) {
          await browser.send('network.continueRequest', {
            request: event.request.request,
          });

          return;
        }

        await browser.send('network.provideResponse', {
          request: event.request.request,
          statusCode: 200,
          headers: [
            {
              name: 'Content-Type',
              value: { type: 'string', value: value.contentType },
            },
            {
              name: 'Cache-Control',
              value: { type: 'string', value: 'no-store' },
            },
          ],
          body: { type: 'base64', value: value.body.toString('base64') },
        });
      });

      await browser.send('network.addIntercept', {
        phases: ['beforeRequestSent'],
        urlPatterns: [
          {
            type: 'pattern',
            protocol: gameUrl.protocol.slice(0, -1),
            hostname: gameUrl.hostname,
            ...(gameUrl.port ? { port: gameUrl.port } : {}),
          },
        ],
      });
    } else {
      version = await browser.send('Browser.getVersion');
    }

    for (let index = 0; index < 4; index++) {
      if (options.browser === 'firefox') {
        const { userContext } = await browser.send('browser.createUserContext');

        if (networkPermission) {
          try {
            await browser.send('permissions.setPermission', {
              descriptor: { name: networkPermission },
              state: 'granted',
              origin: gameUrl.origin,
              userContext,
            });

            permissionOverrides.push({
              client: index,
              name: networkPermission,
              origin: gameUrl.origin,
              scope: 'temporary-user-context',
              state: 'granted',
            });
          } catch (error) {
            permissionOverrides.push({
              client: index,
              name: networkPermission,
              supported: false,
              diagnostic:
                error instanceof Error ? error.message : JSON.stringify(error),
            });
          }
        }

        await browser.send('script.addPreloadScript', {
          functionDeclaration: `() => { ${preload} }`,
          userContexts: [userContext],
        });

        const { context } = await browser.send('browsingContext.create', {
          type: 'window',
          userContext,
        });

        await browser.send('browsingContext.setViewport', {
          context,
          viewport: { width: options.width, height: options.height },
          devicePixelRatio: 1,
        });

        const { clientWindows } = await browser.send(
          'browser.getClientWindows',
        );
        const window =
          clientWindows.find((value: BrowserReply) => value.active) ||
          clientWindows.at(-1);

        if (window) {
          await browser.send('browser.setClientWindowState', {
            clientWindow: window.clientWindow,
            state: 'normal',
            x: (index % 2) * (options.width + 24),
            y: Math.floor(index / 2) * (options.height + 120),
            width: options.width + 24,
            height: options.height + 120,
          });
        }

        pages.push({
          evaluate: async (expression, command) => {
            const reply = await browser.send(
              'script.evaluate',
              {
                expression: `(async () => JSON.stringify(await (${expression})))()`,
                target: { context },
                awaitPromise: true,
              },
              command,
            );

            if (reply.type === 'exception') {
              throw Error(JSON.stringify(reply.exceptionDetails));
            }

            return reply.result.value === undefined
              ? undefined
              : JSON.parse(reply.result.value);
          },
          key: async (type, key) => {
            const value =
              (
                {
                  Shift: '\uE008',
                  ArrowLeft: '\uE012',
                  ArrowRight: '\uE014',
                  ArrowUp: '\uE013',
                } as Record<string, string>
              )[key] || key;

            await browser.send('input.performActions', {
              context,
              actions: [
                {
                  type: 'key',
                  id: 'actor-keyboard',
                  actions: [{ type, value }],
                },
              ],
            });
          },
          activate: async () => {
            await browser.send('browsingContext.activate', { context });
          },
        });

        await browser.send('browsingContext.navigate', {
          context,
          url: options.url,
          wait: 'complete',
        });

        continue;
      }

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

      const targets = await (
        await fetch(`http://127.0.0.1:${port}/json`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        })
      ).json();

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

      await send('Page.addScriptToEvaluateOnNewDocument', { source: preload });

      const { windowId } = await browser.send('Browser.getWindowForTarget', {
        targetId,
      });

      await browser.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: (index % 2) * (options.width + 24),
          top: Math.floor(index / 2) * (options.height + 120),
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
      });

      await send('Page.navigate', { url: options.url });
    }

    return {
      pages,
      close,
      errors,
      metadata: {
        browser: options.browser,
        version,
        permissionOverrides,
        launchArguments: args.map((arg) =>
          arg.startsWith('--user-data-dir=')
            ? '--user-data-dir=<temporary>'
            : arg === profile
              ? '<temporary>'
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
