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
