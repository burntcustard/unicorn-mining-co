import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { flatConfigs } from 'eslint-plugin-import-x';
import globals from 'globals';

export default [
  { ignores: ['dist/'] },
  js.configs.recommended,
  flatConfigs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/indent': ['error', 2],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { allowTemplateLiterals: 'always' }],
      '@stylistic/semi': ['error', 'always'],
      'import-x/order': ['error', {
        alphabetize: { caseInsensitive: true, order: 'asc' },
        'newlines-between': 'never',
      }],
      'no-console': 'off',
      'sort-imports': ['error', { ignoreDeclarationSort: true }],
    },
  },
  {
    files: ['eslint.config.js', 'plugins/**/*.js', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
