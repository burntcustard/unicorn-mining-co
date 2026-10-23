import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { browserAction } from '../../benchmarking/rendering/browser-action.ts';

// BiDi encodes objects as [key, RemoteValue] pairs; CDP returns plain objects.
// Both protocols deliver a string primitive unchanged. Exercise the evaluated
// browser expression, rather than passing an already serialized fixture to it.
for (const transport of ['cdp', 'bidi']) {
  for (const expected of [
    { 'player-ship-id': 281474976717551, nested: { x: 3, y: -2 } },
    '{"fps":60}',
    'ready',
  ]) {
    const fixture = Object.fromEntries([
      [
        'perf-capture',
        async (name: string) => {
          assert.equal(name, '/pirate');
          return expected;
        },
      ],
    ]);

    const evaluate = async (expression: string) => {
      const value = await runInNewContext(expression, { window: fixture });

      const remote =
        transport === 'bidi' && typeof value === 'object'
          ? {
              value: Object.entries(value).map(([key, item]) => [
                key,
                { value: item },
              ]),
            }
          : { value };

      assert.equal(typeof remote.value, 'string');
      return remote.value;
    };

    assert.deepEqual(await browserAction(evaluate, 'pirate'), expected);
  }
}
