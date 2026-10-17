import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins';

const status = { hidden: true, textContent: '' };
const sockets: TestWebSocket[] = [];

class TestWebSocket {
  static OPEN = 1;
  readyState = 1;
  onclose?: (event: { code: number; reason: string }) => void;

  constructor() {
    sockets.push(this);
  }

  send() {}
}

Object.assign(globalThis, {
  document: {
    fonts: { check: () => false },
    getElementById: (id: string) =>
      id === 'connection-status' ? status : null,
  },
  location: { protocol: 'http:', host: 'localhost' },
  WebSocket: TestWebSocket,
  Path2D: class {
    addPath() {}
  },
});

const entry = resolve('src/__connection_test.ts');
const bannedMessage =
  'Sorry, you have been banned. Contact john@burnt.io if you think this was a mistake';

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entry,
    plugins: [
      {
        name: 'connection-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? `import {NetworkClient} from '${resolve('src/client/network/network.ts')}';
               export default () => new NetworkClient({url: 'test'});`
            : undefined,
      },
      ...(production
        ? [buildPrePlugin(), { ...buildPlugin(), generateBundle: undefined }]
        : []),
    ],
  });

  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  const connect = (
    await import(
      `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
    )
  ).default;

  for (const [code, reason, expected] of [
    [4003, bannedMessage, bannedMessage],
    [4001, 'Session opened elsewhere', 'GAME OPEN IN ANOTHER TAB'],
    [4002, 'Idle timeout', 'AWAY TOO LONG - RELOAD TO PLAY'],
    [1006, '', 'CONNECTION LOST - RETRYING...'],
  ] as const) {
    connect();
    let retries = 0;
    const setTimeout = globalThis.setTimeout;

    Object.assign(globalThis, {
      setTimeout: () => {
        retries++;
        return 0;
      },
    });

    try {
      sockets.at(-1)!.onclose!({ code, reason });
      assert.equal(status.hidden, false);
      assert.equal(status.textContent, expected);
      assert.equal(retries, code === 1006 ? 1 : 0);
    } finally {
      globalThis.setTimeout = setTimeout;
    }
  }
}
