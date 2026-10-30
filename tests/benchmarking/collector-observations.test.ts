import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import {
  npcDocked,
  npcObservations,
} from '../../benchmarking/npc/observations.ts';
import { parseRenderingOptions } from '../../benchmarking/rendering/options.ts';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins.ts';

assert.deepEqual(parseRenderingOptions({ args: [] }).scenarios, [
  'live',
  'large',
  'combat',
  'flight',
  'pirate',
]);
assert.throws(
  () =>
    parseRenderingOptions({ args: ['--scenario', 'collector-idle,collector'] }),
  /Choose scenarios: live, large, combat, flight, pirate/,
);

const observations = npcObservations();

const docking = {
  type: 'chat' as const,
  channel: 0,
  sender: 'NPC benchmark',
  senderRole: 'friendly',
  text: '/npc-benchmark-docked 281474976710965 2100',
};

assert.deepEqual(npcDocked(docking), { id: 281474976710965, tick: 2100 });
assert.equal(npcDocked({ ...docking, sender: 'Another player' }), undefined);
assert.equal(
  npcDocked({ ...docking, text: "I've returned to the station" }),
  undefined,
);
assert.equal(
  npcDocked({ ...docking, text: '/npc-benchmark-docked 0 12' }),
  undefined,
);
assert.equal(
  npcDocked({ ...docking, text: '/npc-benchmark-docked 9007199254740992 12' }),
  undefined,
);

observations.observe({ ships: [] });

observations.observe({
  ships: [
    {
      id: 4,
      position: { x: 0, y: 0 },
      cargo: 0,
      state: 'Collecting',
      visible: true,
    },
  ],
});

observations.observe({
  ships: [
    {
      id: 4,
      position: { x: 3, y: 4 },
      cargo: 2,
      state: 'Returning',
      visible: false,
    },
  ],
});

observations.observe({ ships: [] });

assert.deepEqual(observations.summary(), {
  samples: 4,
  'occupied-samples': 2,
  'maximum-active': 1,
  ships: [
    {
      'ship-id': 4,
      samples: 2,
      'visible-samples': 1,
      'path-distance': 5,
      'maximum-cargo': 2,
      states: ['Collecting', 'Returning'],
    },
  ],
});

// Exercise the same source injection and production property transforms used
// by the browser fixture; exported report keys must retain their long names.
const entry = resolve('src/__collector_observations_test.ts');

const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'collector-observations-test',
      resolveId: (id) => (id === entry ? id : undefined),
      load: (id) =>
        id === entry
          ? `
const npcObservations = ${npcObservations.toString()};
const observations = npcObservations();
observations.observe({ships:[{id:7,position:{x:1,y:2},cargo:3,state:'Collecting',visible:true}]});
Reflect.set(globalThis,'collector-report-test',observations.summary());
`
          : undefined,
    },
    buildPrePlugin(),
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

try {
  const { output } = await bundle.generate({ format: 'esm' });

  await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  );
  const result = Reflect.get(globalThis, 'collector-report-test');

  assert.equal(result['maximum-active'], 1);
  assert.equal(result.ships[0]['maximum-cargo'], 3);
  assert.equal(result.ships[0]['visible-samples'], 1);
} finally {
  await bundle.close();
  Reflect.deleteProperty(globalThis, 'collector-report-test');
}
