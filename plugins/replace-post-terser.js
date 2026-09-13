import { parse } from 'acorn';

/**
 * These spellings target the packed ZIP, so they deliberately add source bytes.
 * Apply after Terser: its printer would undo the parentheses and number spelling.
 */
export const replacePostTerser = (source) => {
  const edits = [];

  const visit = (node, parent) => {
    if (!node?.type) return;

    if (node.type === 'Property' && !node.computed && !node.shorthand &&
      node.key.type === 'Identifier' && node.key.name !== 'length') {
      // Keep length eligible for Roadroller's five identifier abbreviations.
      // Quoting it displaces length with var and makes this bundle larger.
      // Identifier names cannot contain a single quote, so this is safe here.
      edits.push([node.key.start, node.key.end, `'${node.key.name}'`]);
    }

    if (node.type === 'ArrowFunctionExpression' && node.params.length === 1 &&
      node.params[0].type === 'Identifier') {
      const param = node.params[0];

      if (source.slice(node.start, param.start).trim() === '') {
        edits.push([param.start, param.end, `(${source.slice(param.start, param.end)})`]);
      }
    }

    if (node.type === 'Literal' && typeof node.value === 'number' &&
      Number.isFinite(node.value) && /^[\d.]+e[+-]?\d+$/i.test(node.raw)) {
      let number = String(node.value);

      if (number !== node.raw) {
        // Keep 1e3.toString() and return.1e3 valid after expanding the number.
        if (parent.type === 'MemberExpression' && parent.object === node) {
          number = `(${number})`;
        } else if (/[\w$]/.test(source[node.start - 1] || '')) {
          number = ` ${number}`;
        }

        edits.push([node.start, node.end, number]);
      }
    }

    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((child) => visit(child, node));
      } else if (value?.type) {
        visit(value, node);
      }
    });
  };

  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));

  // Edit only parsed syntax nodes, never strings, regexes or template text.
  // Back-to-front edits retain the parser's offsets, including nested arrows.
  return edits.sort((a, b) => b[0] - a[0]).reduce(
    (code, [start, end, replacement]) => code.slice(0, start) + replacement + code.slice(end),
    source,
  );
};
