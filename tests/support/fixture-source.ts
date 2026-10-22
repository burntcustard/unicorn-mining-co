/*
 * Keep packet histories out of the minifier. Only the fixture's property names
 * need production transforms; the JSON bytes are runtime input, like packets.
 */
export function fixtureSource(value: unknown) {
  const keys = new Set<string>();

  const json = JSON.stringify(value, (key, value) => {
    if (/^[A-Za-z_]\w*$/.test(key)) keys.add(key);

    return value;
  });

  Reflect.set(globalThis, Symbol.for('unicorn.test.fixture'), [
    [...keys],
    json,
  ]);

  return `(() => {
    const [keys, json] = globalThis[Symbol.for('unicorn.test.fixture')];
    const names = Object.keys({${[...keys].map((key) => `${key}:0`).join(',')}});
    const mapping = new Map(keys.map((key, index) => [key, names[index]]));
    return JSON.parse(json, (_, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).map(([key, value]) => [mapping.get(key) ?? key, value]))
        : value);
  })()`;
}
