import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';

export default defineConfig([
  globalIgnores(['dist/']),
  js.configs.recommended,
  stylistic.configs.recommended,
  {
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@stylistic/arrow-parens': ['error', 'always'],
      '@stylistic/brace-style': ['error', '1tbs'],
      // 'minimum' allows padding after the colon, so values can be aligned
      '@stylistic/key-spacing': ['error', { mode: 'minimum' }],
      '@stylistic/no-multi-spaces': ['error', { ignoreEOLComments: true }],
      '@stylistic/operator-linebreak': ['error', 'after'],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
      ],
      '@stylistic/semi': ['error', 'always'],
      'curly': ['error', 'multi-line', 'consistent'],
      'no-duplicate-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'IfStatement[alternate][consequent.type!="BlockStatement"]',
          message: 'Use braces around if/else branches.',
        },
        {
          selector: 'IfStatement[alternate][consequent.type="BlockStatement"]' +
            '[alternate.type!="BlockStatement"][alternate.type!="IfStatement"]',
          message: 'Use braces around if/else branches.',
        },
      ],
      'sort-imports': 'error',
    },
  },
  {
    files: ['eslint.config.js', 'plugins/**/*.js', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
