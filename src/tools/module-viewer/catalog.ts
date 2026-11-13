import { moduleTypesById } from '../../client/objects/modules';
import { moduleSpecs, type ModuleId } from '../../specs/modules';

const specs = import.meta.glob<Record<string, unknown>>(
  ['../../specs/modules/**/*.ts', '!../../specs/modules/**/index.ts'],
  { eager: true },
);

// The game catalog contains only playable modules; the glob supplies their
// source paths without treating helper and example specs as modules.
export const catalog = Object.entries(specs)
  .flatMap(([path, exports]) => {
    const [category, ...rest] = path.split('/modules/')[1].split('/');
    const folders = rest.slice(0, -1);

    return Object.keys(exports).flatMap((name) => {
      if (!Object.hasOwn(moduleSpecs, name)) return [];
      const id = name as ModuleId;
      const Type = moduleTypesById.get(id);

      return Type
        ? [{ id, category, folder: folders.join('/'), source: path, Type }]
        : [];
    });
  })
  .sort((a, b) => a.source.localeCompare(b.source, 'en-US'));
