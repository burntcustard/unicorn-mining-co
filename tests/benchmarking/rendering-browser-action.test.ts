import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { browserAction } from '../../benchmarking/rendering/browser-action.ts';

// CDP and BiDi both deliver string primitives unchanged. The browser must
// serialize before returning a value to either transport.
for (const expected of [
  { 'player-ship-id': 281474976717551, nested: { x: 3, y: -2 } },
  '{"fps":60}',
  'ready',
]) {
  const page = {
    'perf-capture': async (name: string) => {
      assert.equal(name, '/pirate');
      return expected;
    },
  };

  const evaluate = async (expression: string) => {
    const result = await runInNewContext(expression, { window: page });

    assert.equal(typeof result, 'string');
    return result;
  };

  assert.deepEqual(await browserAction(evaluate, 'pirate'), expected);
}
