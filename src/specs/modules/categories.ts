export const moduleCategoryIds = ['core', 'offense', 'utility'] as const;

export type ModuleCategory = (typeof moduleCategoryIds)[number];

export const moduleCategories = new Map<
  ModuleCategory,
  { name: string; color: string }
>([
  ['core', { name: 'CORE', color: '#e6f' }],
  ['offense', { name: 'OFFENSE', color: '#fe4' }],
  ['utility', { name: 'UTILITY', color: '#3f7' }],
]);
