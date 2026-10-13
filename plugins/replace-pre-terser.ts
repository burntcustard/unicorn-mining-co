import { parseAst } from 'rolldown/parseAst';
import type { Node } from '@oxc-project/types';
import { propertyNames } from './property-names.ts';
import { protocolTags, encodeProtocolTags } from './protocol-tags.ts';

// Kontra-style compile-time flags. `@ifdef` keeps a block when its flag is
// truthy, while `@ifndef` keeps it when false.
const ifdefPattern =
  /^[ \t]*\/\/ @(ifdef|ifndef) (\w+)\r?\n([\s\S]*?)^[ \t]*\/\/ @endif\r?\n?/gm;

/**
 * Strip compile-time feature blocks before TypeScript is transpiled.
 */
export const stripIfdef = (
  source: string,
  flags: Record<string, boolean> = {},
) =>
  source.replace(ifdefPattern, (match, condition, flag, body) =>
    (condition === 'ifdef') === !!flags[flag] ? body : '',
  );

const tagPattern = new RegExp(
  '([\'"`])(' + protocolTags.join('|') + ')\\1',
  'g',
);

// Consume complete quoted strings before matching properties. A path-like
// string stays literal; other strings may contain dynamic property keys.
// Matching only path-like quotes can mistake code between two literals for a
// path when that code contains a ternary colon.
const propertyNamePattern = new RegExp(
  `\\b(${propertyNames.join('|')})\\b`,
  'g',
);
const propertyPattern = new RegExp(
  String.raw`(["'])(?:\\.|(?!\1)[^\\\r\n])*\1|\b(?:export\s+)?function\s+distance\b|\bVec\.distance\b|\bclassList\s*\.\s*(?:contains|remove|toggle)\b|\bstyle\s*\.\s*transform\b|\b(${propertyNames.join('|')})\b`,
  'g',
);

/**
 * Source-level rewrites that help Terser compress the production JavaScript.
 */
export const replacePreTerser = (
  src: string,
  { preserveStrings = false }: { preserveStrings?: boolean } = {},
) => {
  // HTML quotes inside template text must not hide JavaScript interpolations
  // from the property rewrite. Protect only the literal spans, not expressions.
  const literals: string[] = [];

  if (src.includes('/') || (preserveStrings && src.includes('`'))) {
    const spans: { start: number; end: number }[] = [];

    const visit = (node: Node) => {
      if (
        (preserveStrings && node.type === 'TemplateElement') ||
        (node.type === 'Literal' && 'regex' in node)
      ) {
        spans.push(node);
      }

      Object.values(node).forEach((value) => {
        if (Array.isArray(value)) {
          value.forEach((child) => {
            if (child?.type) visit(child);
          });
        } else if (value?.type) {
          visit(value);
        }
      });
    };

    visit(parseAst(src));

    spans
      .sort((a, b) => b.start - a.start)
      .forEach((span) => {
        const token = `__UI_LITERAL_${literals.length}__`;

        literals.push(src.slice(span.start, span.end));
        src = src.slice(0, span.start) + token + src.slice(span.end);
      });
  }

  return src
    .replace(
      tagPattern,
      (_, quote, tag) =>
        quote + (preserveStrings ? tag : encodeProtocolTags.get(tag)) + quote,
    )
    .replace(propertyPattern, (match, quote, name) => {
      if (quote) {
        return preserveStrings || match.includes('/') || /[:-]|\s/.test(match)
          ? match
          : match.replace(propertyNamePattern, (property) => `_${property}`);
      }

      return name ? `_${name}` : match;
    })
    .replace(/__UI_LITERAL_(\d+)__/g, (_, index) => literals[Number(index)]);
};
