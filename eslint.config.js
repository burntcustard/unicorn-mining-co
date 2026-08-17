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
      '@stylistic/no-multi-spaces': ['error', { ignoreEOLComments: true }],
      '@stylistic/operator-linebreak': ['error', 'after'],
      '@stylistic/semi': ['error', 'always'],
      'no-duplicate-imports': 'error',
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
