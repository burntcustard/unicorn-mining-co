import type { Context, Rule, Program, SwitchCase } from 'oxlint/plugins-dev';

type SpacingNode = Program['body'][number] | SwitchCase;

const isVariable = (node: SpacingNode) =>
  node.type === 'VariableDeclaration' ||
  (node.type === 'ExportNamedDeclaration' &&
    node.declaration?.type === 'VariableDeclaration');

const blockTypes = new Set([
  'BlockStatement',
  'ClassBody',
  'TSInterfaceBody',
  'TSTypeLiteral',
  'TSEnumBody',
  'TSModuleBlock',
]);

const hasBlock = (context: Context, value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;

  const node = value as {
    type: string;
    loc: Program['loc'];
    [key: string]: unknown;
  };

  if (blockTypes.has(node.type)) return true;

  if (
    node.type === 'ObjectExpression' &&
    node.loc.start.line !== node.loc.end.line
  ) {
    return true;
  }

  return (context.sourceCode.visitorKeys[node.type] ?? []).some((key) => {
    const child = node[key];

    return Array.isArray(child)
      ? child.some((node) => hasBlock(context, node))
      : hasBlock(context, child);
  });
};

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

const checkStatements = (context: Context, statements: SpacingNode[]) => {
  for (let index = 1; index < statements.length; index++) {
    const previous = statements[index - 1];
    const current = statements[index];

    const afterVariables = isVariable(previous) && !isVariable(current);
    const beforeControl = controlStatements.has(current.type);
    const aroundBlock =
      hasBlock(context, previous) || hasBlock(context, current);

    if (!afterVariables && !beforeControl && !aroundBlock) continue;

    let start = current.range[0];
    let startLine = current.loc.start.line;
    let startColumn = current.loc.start.column;

    for (const comment of context.sourceCode
      .getCommentsBefore(current)
      .toReversed()) {
      if (
        comment.loc.end.line !== startLine - 1 ||
        comment.loc.start.line <= previous.loc.end.line
      ) {
        break;
      }

      start = comment.range[0];
      startLine = comment.loc.start.line;
      startColumn = comment.loc.start.column;
    }

    const between = context.sourceCode.text.slice(previous.range[1], start);

    if (/\n\s*\n/.test(between)) continue;

    context.report({
      node: current,
      message: afterVariables
        ? 'Add a blank line after the variable declarations.'
        : beforeControl
          ? 'Add a blank line before the control statement.'
          : 'Add a blank line around the block.',
      fix: (fixer) => {
        if (previous.loc.end.line === current.loc.start.line) {
          return fixer.insertTextBefore(current, '\n\n');
        }

        const lineStart = start - startColumn;

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
                  'Use // for single-line comments, or start documentation comments with /** followed by a newline.',
                fix: (fixer) => {
                  if (source.includes('\n')) return null;
                  const restOfLine = context.sourceCode.text
                    .slice(comment.range[1])
                    .split(/\r?\n/, 1)[0];

                  if (restOfLine.trim()) return null;
                  const content = source.slice(3, -2).trim();

                  return fixer.replaceTextRange(comment.range, `// ${content}`);
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
          TSModuleBlock: (node) => checkStatements(context, node.body),
          SwitchCase: (node) => checkStatements(context, node.consequent),
          SwitchStatement: (node) =>
            checkStatements(
              context,
              node.cases.filter((branch) => branch.consequent.length),
            ),
        };
      },
    },
  } satisfies Record<string, Rule>,
};
