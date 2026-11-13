import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { format } from 'oxfmt';
import type { SoundEffect } from '../../client/audio/synthesis.ts';
import {
  compactOptional,
  normalizeSoundName,
  soundEvents,
  soundId,
  validateSound,
  type SavedSound,
  type SoundDocument,
  type SoundName,
} from './parameters.ts';

export class SoundDataError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type ResourceKind = 'sound' | 'layer';

type LayerDocument = { data: SoundEffect; revision: string };

type Resource = { name: string; file: string };

const reserved = ['engine', 'hornDrill', 'unassigned'];
const revisionOf = (source: string) =>
  createHash('sha256').update(source).digest('hex');

export const validSoundId = (id: string) =>
  id.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id);

const plainObject = (value: unknown, keys: string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SoundDataError('The sound request must be a JSON object.');
  }

  const fields = value as Record<string, unknown>;

  if (
    Object.keys(fields).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(fields, key))
  ) {
    throw new SoundDataError(
      `The sound request needs exactly: ${keys.join(', ')}.`,
    );
  }

  return fields;
};

const canonicalName = (input: unknown, creating = false) => {
  try {
    const name = normalizeSoundName(input as string);

    if (!validSoundId(soundId(name)) || (creating && reserved.includes(name))) {
      throw new Error(
        'Choose a name other than engine, horn drill, or unassigned.',
      );
    }

    return name;
  } catch (error) {
    throw new SoundDataError(
      creating ? (error as Error).message : 'Unknown sound.',
      creating ? 400 : 404,
    );
  }
};

const validateValue = (kind: ResourceKind, name: string, value: unknown) => {
  try {
    validateSound(name, kind === 'layer' ? [value] : value);
  } catch (error) {
    throw new SoundDataError((error as Error).message);
  }
};

const compactValue = (kind: ResourceKind, name: string, value: unknown) => {
  if (kind === 'layer') return compactOptional(value as SoundEffect);

  if (name === 'engine' || name === 'hornDrill') return value;
  return (value as SoundEffect[]).map(compactOptional);
};

const serialize = async (kind: ResourceKind, name: string, value: unknown) => {
  const type =
    kind === 'layer'
      ? 'SoundEffect'
      : name === 'engine'
        ? 'EngineSoundSettings'
        : name === 'hornDrill'
          ? 'HornDrillSoundSettings'
          : 'SoundEffect[]';
  const source = `import type { ${type.replace('[]', '')} } from '${kind === 'layer' ? '../../../' : '../../'}client/audio/synthesis';

export default ${JSON.stringify(value)} satisfies ${type};
`;

  const formatted = await format(`${soundId(name)}.ts`, source, {
    singleQuote: true,
    printWidth: 80,
  });

  if (formatted.errors.length) {
    throw new Error(
      'Could not format the sound data. The source was not changed.',
    );
  }

  return formatted.code;
};

/**
 * Discover authored files and keep independent revisions for events and presets.
 */
export const createSoundStore = (directory: string) => {
  const pending = new Map<string, Promise<void>>();
  const folderFor = (kind: ResourceKind) =>
    kind === 'layer' ? join(directory, 'unassigned') : directory;

  const ensureDirectory = async (kind: ResourceKind, create = false) => {
    const folder = folderFor(kind);

    try {
      const stats = await lstat(folder);

      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new SoundDataError(
          'Sound specs must be stored in a regular directory.',
        );
      }
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
        kind !== 'layer'
      ) {
        throw error;
      }

      if (create) {
        try {
          await mkdir(folder);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }

        const stats = await lstat(folder);

        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          throw new SoundDataError(
            'Sound specs must be stored in a regular directory.',
          );
        }
      } else {
        return false;
      }
    }

    return true;
  };

  const discover = async (kind: ResourceKind) => {
    if (!(await ensureDirectory(kind))) return new Map<string, Resource>();
    const resources = new Map<string, Resource>();

    for (const entry of await readdir(folderFor(kind), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const id = entry.name.slice(0, -3);

      if (!validSoundId(id)) continue;
      const name = canonicalName(id);

      if (reserved.includes(name)) continue;

      if (resources.has(name)) {
        throw new SoundDataError(
          `Several spec files use the name ${name}.`,
          409,
        );
      }

      resources.set(name, { name, file: join(folderFor(kind), entry.name) });
    }

    return resources;
  };

  const resourceFor = async (kind: ResourceKind, input: string) => {
    const name = canonicalName(input);

    if (kind === 'sound' && (name === 'engine' || name === 'hornDrill')) {
      return { name, file: join(directory, `${soundId(name)}.ts`) };
    }

    const resource = (await discover(kind)).get(name);

    if (!resource) throw new SoundDataError('Unknown sound.', 404);

    return resource;
  };

  const readSource = async (file: string) => {
    try {
      const stats = await lstat(file);

      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new SoundDataError('Unknown sound.', 404);
      }

      return await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new SoundDataError('Unknown sound.', 404);
      }

      throw error;
    }
  };

  const readLocated = async (kind: ResourceKind, { name, file }: Resource) => {
    const source = await readSource(file);
    const { default: data } = await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`
    );

    validateValue(kind, name, data);
    return { data, revision: revisionOf(source) };
  };

  const readResource = async (kind: ResourceKind, input: string) =>
    readLocated(kind, await resourceFor(kind, input));

  const saveResource = async (
    kind: ResourceKind,
    input: string,
    document: unknown,
  ) => {
    const { name, file } = await resourceFor(kind, input);
    const payload = plainObject(document, ['data', 'revision']);

    if (
      typeof payload.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(payload.revision)
    ) {
      throw new SoundDataError('The saved sound needs its loaded revision.');
    }

    validateValue(kind, name, payload.data);

    const data = compactValue(kind, name, payload.data);
    const changed = () =>
      new SoundDataError(
        'This sound changed on disk. Wait for the editor to update before saving again.',
        409,
      );

    if (revisionOf(await readSource(file)) !== payload.revision) {
      throw changed();
    }

    const source = await serialize(kind, name, data);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' });

      if (revisionOf(await readSource(file)) !== payload.revision) {
        throw changed();
      }

      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }

    return { data, revision: revisionOf(source) };
  };

  const createResource = async (kind: ResourceKind, document: unknown) => {
    const payload = plainObject(document, ['name', 'data']);
    const name = canonicalName(payload.name, true);

    validateValue(kind, name, payload.data);
    await ensureDirectory(kind, true);

    if ((await discover(kind)).has(name)) {
      throw new SoundDataError('A sound with this name already exists.', 409);
    }

    const data = compactValue(kind, name, payload.data);
    const source = await serialize(kind, name, data);
    const file = join(folderFor(kind), `${soundId(name)}.ts`);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' });

      try {
        // Linking a complete temporary file publishes it without replacing any
        // existing destination, including a file created by an external editor.
        await link(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new SoundDataError(
            'A sound with this name already exists.',
            409,
          );
        }

        throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }

    return { name, data, revision: revisionOf(source) };
  };

  const queue = <T>(key: string, operation: () => Promise<T>) => {
    const result = (pending.get(key) || Promise.resolve()).then(operation);

    pending.set(
      key,
      result.then(
        () => {},
        () => {},
      ),
    );

    return result;
  };

  return {
    async readSound<N extends SoundName>(name: N): Promise<SavedSound<N>> {
      return readResource('sound', name);
    },
    async readLayer(name: string): Promise<LayerDocument> {
      return readResource('layer', name);
    },
    async read(): Promise<SoundDocument> {
      const events = await discover('sound');
      const eventNames = [
        ...soundEvents.filter((name) => events.has(name)),
        ...[...events.keys()]
          .filter(
            (name) =>
              !soundEvents.includes(name as (typeof soundEvents)[number]),
          )
          .sort((a, b) => a.localeCompare(b, 'en-US')),
      ];
      const names = [...eventNames, 'engine', 'hornDrill'];

      const sounds = Object.fromEntries(
        await Promise.all(
          names.map(async (name) => [
            name,
            await readLocated(
              'sound',
              events.get(name) || {
                name,
                file: join(directory, `${soundId(name)}.ts`),
              },
            ),
          ]),
        ),
      );

      const library = await discover('layer');
      const layerNames = [...library.keys()].sort((a, b) =>
        a.localeCompare(b, 'en-US'),
      );
      const layers = Object.fromEntries(
        await Promise.all(
          layerNames.map(async (name) => [
            name,
            await readLocated('layer', library.get(name)!),
          ]),
        ),
      );

      return {
        effectData: Object.fromEntries(
          eventNames.map((name) => [name, sounds[name].data]),
        ),
        continuousData: {
          engine: sounds.engine.data,
          hornDrill: sounds.hornDrill.data,
        },
        revisions: Object.fromEntries(
          names.map((name) => [name, sounds[name].revision]),
        ),
        unassigned: Object.fromEntries(
          layerNames.map((name) => [name, layers[name].data]),
        ),
        layerRevisions: Object.fromEntries(
          layerNames.map((name) => [name, layers[name].revision]),
        ),
      };
    },
    save<N extends SoundName>(
      name: N,
      document: unknown,
    ): Promise<SavedSound<N>> {
      return queue(`sound:${canonicalName(name)}`, () =>
        saveResource('sound', name, document),
      ) as Promise<SavedSound<N>>;
    },
    saveLayer(name: string, document: unknown): Promise<LayerDocument> {
      return queue(`layer:${canonicalName(name)}`, () =>
        saveResource('layer', name, document),
      ) as Promise<LayerDocument>;
    },
    createEvent(
      document: unknown,
    ): Promise<{ name: string; data: SoundEffect[]; revision: string }> {
      return queue('create:sound', () =>
        createResource('sound', document),
      ) as Promise<{ name: string; data: SoundEffect[]; revision: string }>;
    },
    createLayer(document: unknown): Promise<LayerDocument & { name: string }> {
      return queue('create:layer', () =>
        createResource('layer', document),
      ) as Promise<LayerDocument & { name: string }>;
    },
  };
};
