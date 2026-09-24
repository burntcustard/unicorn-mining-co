const isVariable = (node) => node.type === 'VariableDeclaration';
const controlStatements = new Set([
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'IfStatement',
  'SwitchCase',
  'SwitchStatement',
  'TryStatement',
  'WhileStatement',
]);

const checkStatements = (context, statements) => {
  for (let index = 1; index < statements.length; index++) {
    const previous = statements[index - 1];
    const current = statements[index];

    const afterVariables = isVariable(previous) && !isVariable(current);
    const beforeControl = controlStatements.has(current.type);

    if (!afterVariables && !beforeControl) continue;

    const between = context.sourceCode.text.slice(
      previous.range[1],
      current.range[0],
    );

    if (/\n\s*\n/.test(between)) continue;

    context.report({
      node: current,
      message: afterVariables
        ? 'Add a blank line after the variable declarations.'
        : 'Add a blank line before the control statement.',
      fix: (fixer) => {
        if (previous.loc.end.line === current.loc.start.line) {
          return fixer.insertTextBefore(current, '\n\n');
        }

        const lineStart = current.range[0] - current.loc.start.column;

        return fixer.insertTextBeforeRange([lineStart, lineStart], '\n');
      },
    });
  }
};

export default {
  meta: { name: 'local' },
  rules: {
    'multiline-doc-comments': {
      meta: { type: 'layout', fixable: 'whitespace' },
      create(context) {
        // The imported physics engine retains its upstream JSDoc layout.
        const filename = context.physicalFilename.replaceAll('\\', '/');
        const physicsCollisionFiles = new Set([
          'time-of-impact.ts',
          'axis-aligned-bounds.ts',
          'dynamic-tree.ts',
          'outer-edges.ts',
          'collision-shape.ts',
          'broad-phase.ts',
          'contact-manifold.ts',
          'shape-distance.ts',
        ]);
        const collisionFile = filename.split('/src/shared/collision/')[1];
        const importedPhysics =
          /\/src\/shared\/(?:common|dynamics)\//.test(filename) ||
          (collisionFile &&
            (collisionFile.startsWith('shape/') ||
              physicsCollisionFiles.has(collisionFile)));

        if (importedPhysics) return {};

        return {
          Program(node) {
            for (const comment of node.comments) {
              if (comment.type !== 'Block') continue;
              const source = context.sourceCode.text.slice(...comment.range);

              if (
                !source.startsWith('/**') ||
                source[3] === '\n' ||
                source.slice(3, 5) === '\r\n'
              ) {
                continue;
              }
              context.report({
                node: comment,
                message:
                  'Start documentation comments with /** followed by a newline, or use //.',
                fix: (fixer) => {
                  if (source.includes('\n')) return null;
                  const indentation = ' '.repeat(comment.loc.start.column);
                  const content = source.slice(3, -2).trim();

                  return fixer.replaceTextRange(
                    comment.range,
                    `/**\n${indentation} * ${content}\n${indentation} */`,
                  );
                },
              });
            }
          },
        };
      },
    },
    'statement-spacing': {
      meta: { type: 'layout', fixable: 'whitespace' },
      create(context) {
        return {
          Program: (node) => checkStatements(context, node.body),
          BlockStatement: (node) => checkStatements(context, node.body),
          StaticBlock: (node) => checkStatements(context, node.body),
          SwitchStatement: (node) =>
            checkStatements(
              context,
              node.cases.filter((branch) => branch.consequent.length),
            ),
        };
      },
    },
  },
};
