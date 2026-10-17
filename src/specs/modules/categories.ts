import { colors } from '../colors';

export const moduleCategoryIds = ['core', 'offense', 'utility'] as const;

export type ModuleCategory = (typeof moduleCategoryIds)[number];

export const moduleCategories = new Map<
  ModuleCategory,
  { name: string; color: string }
>([
  ['core', { name: 'CORE', color: colors.violet[2] }],
  ['offense', { name: 'OFFENSE', color: colors.orange[2] }],
  ['utility', { name: 'UTILITY', color: colors.green[2] }],
]);
