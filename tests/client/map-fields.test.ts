import assert from 'node:assert/strict';
import { createMapFields } from '../../src/client/ui/map-fields';
import { generateFields } from '../../src/client/simulation/region-generation';
import { generateSector } from '../../src/client/simulation/sector-generation';
import { mapRange } from '../../src/client/ui/sector-map';
import * as Vec from '../../src/client/utilities/vector';
import { rolldown } from 'rolldown';
import { resolve } from 'node:path';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins';

const worldSeed = 25;
const sectorName = 'Patroclus';
const sector = generateSector({ worldSeed, name: sectorName });
const fieldsAt = createMapFields({ worldSeed, sectorName });
const positions = [
  Vec.create(),
  Vec.create(100000, -100000),
  Vec.create(-200000, 190000),
  Vec.create(20000, -8000),
  Vec.create(400000, 300000),
  Vec.create(),
  ...Array.from({ length: 80 }, (_, index) =>
    Vec.create(
      Math.round(Math.sin(index * 3) * 800000),
      Math.round(Math.cos(index * 7) * 800000),
    ),
  ),
];

for (const center of positions) {
  const visible = fieldsAt(center, mapRange);
  const reach = Math.ceil(mapRange * (298 / 296) + 4200);

  const expected = generateFields({
    worldSeed,
    sector,
    from: Vec.create(center.x - reach, center.y - reach),
    to: Vec.create(center.x + reach, center.y + reach),
  }).filter(
    (field) =>
      Vec.distance(field.position, center) <=
      mapRange * (298 / 296) + field.radius + 200,
  );

  const byId = new Map(visible.map((field) => [field.id, field]));

  for (const field of expected) {
    assert.deepEqual(
      [byId.get(field.id)?.position, byId.get(field.id)?.radius],
      [field.position, field.radius],
      `field ${field.id} must be present in the same frame after a fast move to ${center.x},${center.y}`,
    );
  }

  assert.equal(
    fieldsAt(center, mapRange),
    visible,
    'unchanged bounds reuse the generated field list',
  );
}

// Exercise the separately transformed production code, including its mangled
// properties, against the source generator at widely separated coordinates.
const entry = resolve('src/__map_fields_test.ts');

const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'map-fields-entry',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) =>
        id === entry
          ? `
        import { createMapFields } from '${process.cwd()}/src/client/ui/map-fields.ts';
        const fields = createMapFields({ worldSeed: 25, sectorName: 'Patroclus' });
        export default (center, range) => fields(center, range).map(field => [field.id, field.position.x, field.position.y, field.radius]);
      `
          : undefined,
    },
    buildPrePlugin(),
    { ...buildPlugin(), generateBundle: undefined },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();
const production = (
  await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  )
).default;

for (const center of positions) {
  const actual = production(center, mapRange);
  const expected = fieldsAt(center, mapRange).map((field) => [
    field.id,
    field.position.x,
    field.position.y,
    field.radius,
  ]);

  assert.deepEqual(
    actual,
    expected,
    `production fields must match source immediately at ${center.x},${center.y}`,
  );
}
