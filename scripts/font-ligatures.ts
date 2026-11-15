import { Buffer } from 'node:buffer';

type Ligature = { glyph: number; components: number[] };

const words = (...values: number[]) => {
  const result = Buffer.alloc(values.length * 2);

  values.forEach((value, index) => result.writeUInt16BE(value, index * 2));
  return result;
};

/**
 * Build the OpenType GSUB table for default standard ligatures.
 */
export function ligatureTable(ligatures: Ligature[]) {
  const groups = new Map<number, Ligature[]>();

  ligatures.forEach((ligature) => {
    const first = ligature.components[0];
    const group = groups.get(first) || [];

    group.push(ligature);
    groups.set(first, group);
  });

  const firstGlyphs = [...groups.keys()].sort((a, b) => a - b);
  const coverage = words(1, firstGlyphs.length, ...firstGlyphs);

  const sets = firstGlyphs.map((first) => {
    const rules = groups
      .get(first)!
      .toSorted((a, b) => b.components.length - a.components.length)
      .map(({ glyph, components }) =>
        words(glyph, components.length, ...components.slice(1)),
      );
    let offset = 2 + rules.length * 2;

    const offsets = rules.map((rule) => {
      const current = offset;

      offset += rule.length;
      return current;
    });

    return Buffer.concat([words(rules.length, ...offsets), ...rules]);
  });

  const headerSize = 6 + firstGlyphs.length * 2;
  let offset = headerSize + coverage.length;

  const setOffsets = sets.map((set) => {
    const current = offset;

    offset += set.length;
    return current;
  });

  const subtable = Buffer.concat([
    words(1, headerSize, firstGlyphs.length, ...setOffsets),
    coverage,
    ...sets,
  ]);
  const lookupList = Buffer.concat([
    words(1, 4), // One lookup follows the offset array.
    words(4, 0, 1, 8), // Ligature substitution, no flags, one subtable.
    subtable,
  ]);
  const scriptList = Buffer.concat([
    words(1),
    Buffer.from('DFLT'),
    words(8),
    words(4, 0), // Default language system, no language-specific systems.
    words(0, 0xffff, 1, 0), // One optional feature, index zero.
  ]);
  const featureList = Buffer.concat([
    words(1),
    Buffer.from('liga'),
    words(8),
    words(0, 1, 0), // No parameters; lookup index zero.
  ]);

  return Buffer.concat([
    words(
      1,
      0,
      10,
      10 + scriptList.length,
      10 + scriptList.length + featureList.length,
    ),
    scriptList,
    featureList,
    lookupList,
  ]);
}
