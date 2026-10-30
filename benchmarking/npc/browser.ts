import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import type { RawData } from 'ws';
import { loadLatencyAssets } from '../latency/assets.ts';
import { openLatencyBrowser } from '../latency/browser.ts';
import { parseLatencyOptions } from '../latency/options.ts';
import type { ProtocolClient } from '../server/client.ts';
import { npcDocked } from './observations.ts';

type Value = Record<string, any>;

export type NPCFrame = {
  targetID: number | null;
  position: { x: number; y: number };
  camera: { x: number; y: number; width: number; height: number };
  screenPosition: { x: number; y: number };
  onScreen: boolean;
  inScene: boolean;
};

export type NPCCameraStatus = NPCFrame & {
  ready: boolean;
  workers: number;
  frames: number;
  lastFrame?: NPCFrame;
  errors: unknown[];
};

/*
 * tsx preserves inferred function names with a module-local __name helper.
 * Include that helper when moving a function into the isolated browser realm.
 */
export const npcBrowserCall = (
  callback: (...args: any[]) => unknown,
  ...args: unknown[]
) =>
  `(() => { const __name = (value, name) => Object.defineProperty(value, 'name', { value: name, configurable: true }); return (${callback.toString()})(${args.map((value) => JSON.stringify(value)).join(',')}); })()`;

/*
 * The browser receives the existing observer's bytes but cannot send controls
 * or open another game connection. Nothing here creates a second fixture.
 */
export function installNPCMirror() {
  const page = globalThis as unknown as Value;
  const frames: string[] = [];
  let socket: Value;
  let received = 0;
  let discarded = 0;
  let fault = '';

  const drain = () => {
    if (!socket || socket.readyState !== 1 || !socket.onmessage) return;

    for (const frame of frames.splice(0)) {
      const data = Uint8Array.from(atob(frame), (value) =>
        value.charCodeAt(0),
      ).buffer;
      const event = new MessageEvent('message', { data });

      socket.onmessage(event);
      socket.dispatchEvent(event);
      received++;
    }
  };

  page.WebSocket = class extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    bufferedAmount = 0;
    binaryType = 'arraybuffer';
    url: string;
    onopen: (event: Event) => void;
    onmessage: (event: MessageEvent) => void;
    onclose: (event: CloseEvent) => void;

    constructor(url: string) {
      super();
      this.url = url;
      // The external mirror delivers frames to the active fake socket.
      // oxlint-disable-next-line typescript/no-this-alias
      socket = this;

      queueMicrotask(() => {
        this.readyState = 1;
        const event = new Event('open');

        this.onopen?.(event);
        this.dispatchEvent(event);
        drain();
      });
    }

    send() {
      discarded++;
    }

    close(code = 1000, reason = '') {
      this.readyState = 3;
      fault = `Mirror closed: ${code} ${reason}`;
      const event = new CloseEvent('close', { code, reason, wasClean: true });

      this.onclose?.(event);
      this.dispatchEvent(event);
    }
  };

  page.npcMirror = {
    push(batch: string[]) {
      frames.push(...batch);
      drain();
      return { received, queued: frames.length, discarded, fault };
    },
  };
}

/*
 * Follow an actual replicated NPC through the existing renderer. Changing the
 * browser's presentation target has no path back to the authoritative server.
 */
export function installNPCCamera({
  properties,
  scenario,
  targetName,
  repetition,
  repetitions,
  seed,
}: {
  properties: Record<string, string>;
  scenario: string;
  targetName?: string;
  repetition?: number;
  repetitions?: number;
  seed?: number | null;
}) {
  const page = globalThis as unknown as Value;

  if (page.npcCamera) return page.npcCamera();
  const refs = [...new Set(page.__latencyRefs || [])] as Value[];
  const key = (name: string) => properties[name] || name;
  const get = (object: Value | undefined, name: string): any =>
    object?.[key(name)];
  const network = refs.find(
    (value) =>
      value &&
      get(get(value, 'world'), 'entities') instanceof Map &&
      typeof get(value, 'recordInput') === 'function',
  );
  const player = refs.find(
    (value) =>
      value && typeof get(value, 'started') === 'boolean' && get(value, 'ship'),
  );

  document.querySelector<HTMLButtonElement>('[data-action="play"]')?.click();

  const game = refs.find(
    (value) =>
      value &&
      Array.isArray(get(value, 'sprites')) &&
      Array.isArray(get(value, 'crafts')) &&
      get(value, 'camera'),
  );

  if (!network || !player || !game || !get(player, 'started')) return false;
  let targetID = 0;
  let lastTarget: Value;
  let frames = 0;
  let lastFrame: Value;
  const label = document.createElement('div');

  label.className = 'ui-surface ui-card';
  label.id = 'npc-benchmark-debug';
  label.style.cssText =
    'position:fixed;z-index:29;white-space:pre-line;font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:none';
  document.body.append(label);

  const workers = () =>
    [
      ...(
        get(get(network, 'world'), 'entities') as Map<number, Value>
      ).values(),
    ].filter(
      (ship) =>
        get(ship, 'npcState') &&
        !get(ship, 'dead') &&
        (!targetName || get(ship, 'name') === targetName),
    );

  const select = () => {
    // The protocol has a shape-free view anchor, never a playable ship. Keep
    // it out of the scene and radar, including after snapshot reconstruction.
    const observerID = get(get(player, 'ship'), 'id');

    for (const name of ['sprites', 'crafts']) {
      const objects = get(game, name) as Value[];
      const index = objects.findIndex(
        (object) => get(object, 'id') === observerID,
      );

      if (index >= 0) objects.splice(index, 1);
    }

    const ships = workers();
    const target =
      ships.find((ship) => get(ship, 'id') === targetID) || ships[0];

    if (!target && targetName && lastTarget) return lastTarget;
    const id = target ? get(target, 'id') : 0;

    if (id !== targetID) {
      const position = get(target || get(player, 'ship'), 'position');
      const camera = get(game, 'camera');

      camera.x = position.x - get(game, 'width') / 2;
      camera.y = position.y - get(game, 'height') / 2;
      targetID = id;
    }

    lastTarget = target;
    return target;
  };

  // Gameplay reads this only for presentation and scene culling. Ownership,
  // snapshot adoption, prediction and controls continue using the real player.
  Object.defineProperty(game, key('viewShip'), {
    configurable: true,
    get: select,
  });

  const frame = () => {
    const target = select();
    const camera = get(game, 'camera');
    const position = get(target || get(player, 'ship'), 'position');
    const width = get(game, 'width');
    const height = get(game, 'height');

    const screenPosition = {
      x: position.x - camera.x,
      y: position.y - camera.y,
    };

    return {
      targetID: target ? targetID : null,
      position: { x: position.x, y: position.y },
      camera: { x: camera.x, y: camera.y, width, height },
      screenPosition,
      onScreen:
        screenPosition.x >= 0 &&
        screenPosition.x <= width &&
        screenPosition.y >= 0 &&
        screenPosition.y <= height,
      inScene:
        !target ||
        (get(game, 'sprites') as Value[]).some(
          (ship) => get(ship, 'id') === targetID,
        ),
    };
  };

  const complete = page.__latencyComplete;

  page.__latencyComplete = (now: number) => {
    complete?.(now);
    frames++;
    lastFrame = frame();
  };

  const inspect = () => {
    const target = select();
    const ships = workers();

    const chat = document
      .querySelector<HTMLElement>('.chat-panel')
      ?.getBoundingClientRect();

    label.style.left = `${chat?.left ?? 20}px`;
    label.style.top = `${chat ? chat.bottom + chat.top : 24}px`;
    label.style.width = `${chat?.width ?? 384}px`;
    label.textContent = [
      `Benchmark: ${scenario}`,
      repetition ? `Run: ${repetition}/${repetitions}` : null,
      seed !== undefined && seed !== null ? `Seed: ${seed}` : null,
      `Ship: ${target ? get(target, 'name') : 'Waiting for NPCs'}`,
      `State: ${target ? get(target, 'npcState') : 'Waiting'}`,
      `Visible NPCs: ${ships.length}`,
    ]
      .filter((line) => line !== null)
      .join('\n');

    return {
      ready: frames > 0,
      ...frame(),
      workers: ships.length,
      frames,
      lastFrame,
      errors: page.__latencyErrors || [],
    };
  };

  page.npcCamera = inspect;
  return inspect();
}

/*
 * Open one owned Chrome window for the suite. Attach immediately after creating
 * a ProtocolClient, before awaiting ready(), so its initial load is mirrored.
 */
export async function openNPCBrowser({
  url,
  browser = 'chrome',
  signal,
  pageCount = 1,
}: {
  url: string;
  browser?: string;
  signal: AbortSignal;
  pageCount?: number;
}) {
  assert.equal(browser, 'chrome', 'NPC watching currently supports Chrome');
  const production = await loadLatencyAssets();

  const options = {
    ...parseLatencyOptions([
      '--resolution',
      pageCount > 1 ? '1256x960' : '1280x800',
    ]),
    url,
  };

  let closeBrowser: () => Promise<void>;
  const detaches = new Map<number, () => Promise<void>>();
  let closing: Promise<void>;

  const close = () =>
    (closing ??= (async () => {
      try {
        await Promise.all([...detaches.values()].map((detach) => detach()));
      } finally {
        await closeBrowser?.();
      }
    })());

  const owned = await openLatencyBrowser({
    options,
    production,
    signal,
    registerClose: (callback) => (closeBrowser = callback),
    pageCount,
    columns: pageCount > 2 ? 3 : pageCount,
    backgroundRendering: pageCount > 1,
    preloadSource: npcBrowserCall(installNPCMirror),
  });

  let caseID = 0;

  return {
    close,
    metadata: {
      browser: owned.metadata,
      mode: 'passive-binary-mirror',
      views: pageCount,
      columns: pageCount > 2 ? 3 : pageCount,
      additionalServerConnections: 0,
      production: production.metadata,
      note: 'Watching adds local rendering and mirroring work. Compare server CPU with watching disabled.',
    },
    attach(
      client: ProtocolClient,
      {
        scenario,
        targetName,
        index = 0,
        repetition,
        repetitions,
        seed,
      }: {
        scenario: string;
        targetName?: string;
        index?: number;
        repetition?: number;
        repetitions?: number;
        seed?: number | null;
      },
    ) {
      const page = owned.pages[index];

      assert(page, `NPC browser page ${index} is unavailable`);
      assert(
        !detaches.has(index),
        'Detach the previous NPC case before reusing its page',
      );
      const frames: Buffer[] = [];
      let bytes = 0;
      let stopped = false;
      let failure: Error;
      let ready = false;
      let status: NPCCameraStatus;
      let finishReason = 'Capture ended';

      const receive = (raw: RawData, binary: boolean) => {
        if (!binary || stopped) return;
        const data = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw);

        let docked = false;

        try {
          docked = Boolean(
            targetName &&
            data[1] === 0x43 &&
            npcDocked(client.options.runtime.decodeServerControl(data)),
          );
        } catch (error) {
          failure = error as Error;
          stopped = true;
          return;
        }

        if (docked) {
          finishReason = 'Docked';

          // The docking control precedes its snapshots. Stop mirroring now so
          // neither the despawn nor the docking screen can move the camera.
          void end().catch((error: Error) => {
            failure = error;
          });

          return;
        }

        frames.push(data);
        bytes += data.length;

        if (bytes > 32 * 1024 * 1024) {
          failure = Error('NPC mirror fell more than 32MiB behind');
          stopped = true;
        }
      };

      client.socket.on('message', receive);

      const pump = (async () => {
        const target = new URL(url);

        target.searchParams.set('npc-watch', String(++caseID));
        await page.navigate(target.href);
        await page.activate();

        // Page.navigate returns before document replacement. Do not deliver
        // the initial welcome/load into the previous case's disappearing page.
        while (
          !stopped &&
          !(await page.evaluate(
            `location.href === ${JSON.stringify(target.href)} && document.readyState !== 'loading' && Boolean(globalThis.npcMirror)`,
            { timeoutMs: 5000 },
          ))
        ) {
          await pause(50, undefined, { signal });
        }

        while (!stopped) {
          signal.throwIfAborted();
          const batch = frames.splice(0, 64);
          const mirrored = await page.evaluate(
            `globalThis.npcMirror?.push(${JSON.stringify(batch.map((frame) => frame.toString('base64')))})`,
            { timeoutMs: 5000 },
          );

          if (!mirrored) {
            frames.unshift(...batch);
          } else {
            bytes -= batch.reduce((sum, frame) => sum + frame.length, 0);
            assert(!mirrored.fault, mirrored.fault);

            const next = await page.evaluate(
              npcBrowserCall(installNPCCamera, {
                properties: production.properties,
                scenario,
                targetName,
                repetition,
                repetitions,
                seed,
              }),
              { timeoutMs: 5000 },
            );

            status = next || undefined;
            ready ||= Boolean(status?.ready);

            if (ready) {
              assert.equal(
                status.errors.length,
                0,
                `NPC browser errors: ${JSON.stringify(status.errors)}`,
              );
            }
          }

          await pause(50, undefined, { signal });
        }
      })().catch((error: Error) => {
        failure = error;
      });

      let ending: Promise<void>;

      const end = () =>
        (ending ??= (async () => {
          stopped = true;
          client.socket.off('message', receive);
          await pump;
          frames.length = 0;

          try {
            const details = [
              scenario,
              repetition ? `Run: ${repetition}/${repetitions}` : null,
              seed !== undefined && seed !== null ? `Seed: ${seed}` : null,
              finishReason,
            ]
              .filter((line) => line !== null)
              .join('\n');
            const finished = `<title>NPC benchmark</title><body style="margin:0;display:grid;place-content:center;min-height:100vh;background:#07101d;color:white;font:18px monospace"><pre>${details}</pre>`;

            await page.navigate(
              'data:text/html;charset=utf-8,' + encodeURIComponent(finished),
              {
                timeoutMs: 5000,
                duringShutdown: true,
              },
            );
          } finally {
            detaches.delete(index);
          }

          if (failure) throw failure;
        })());

      detaches.set(index, end);

      return {
        close: end,
        status() {
          if (failure) throw failure;
          return status;
        },
        async ready() {
          const deadline = performance.now() + 20000;

          while (!ready) {
            signal.throwIfAborted();

            if (failure) throw failure;
            assert(
              performance.now() < deadline,
              'NPC browser did not enter the mirrored scene within 20 seconds',
            );
            await pause(50, undefined, { signal });
          }

          return status;
        },
      };
    },
  };
}
