import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { parseAst } from 'rolldown/parseAst';
import { preparePropertyCache } from '../../plugins/build-plugins.ts';
import { replacePreTerser } from '../../plugins/replace-pre-terser.ts';
import { propertyNames } from '../../plugins/property-names.ts';
import { encodeProtocolTags } from '../../plugins/protocol-tags.ts';

export const latencyLiterals = Object.fromEntries(
  [...new Set([...encodeProtocolTags.keys(), ...propertyNames])].map(
    (value) => [value, JSON.parse(replacePreTerser(JSON.stringify(value)))],
  ),
);

const digest = (source: Buffer | string) =>
  createHash('sha256').update(source).digest('hex');

/*
 * Retain the production module graph and loading triggers. Appending references
 * to initialized module bindings exposes existing objects without importing a
 * second game, changing a socket URL, or replacing gameplay implementations.
 */
export const exposeLatencyBindings = (source: string) => {
  const names = new Set<string>();

  const binding = (node: any) => {
    if (!node) return;

    if (node.type === 'Identifier') {
      names.add(node.name);
    } else if (node.type === 'ObjectPattern') {
      node.properties.forEach((value: any) =>
        binding(value.value || value.argument),
      );
    } else if (node.type === 'ArrayPattern') {
      node.elements.forEach(binding);
    } else if (node.type === 'AssignmentPattern') {
      binding(node.left);
    } else if (node.type === 'RestElement') {
      binding(node.argument);
    }
  };

  const declaration = (node: any) => {
    if (node.type === 'VariableDeclaration') {
      node.declarations.forEach((value: any) => binding(value.id));
    } else if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'ClassDeclaration'
    ) {
      binding(node.id);
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      declaration(node.declaration);
    }
  };

  parseAst(source).body.forEach(declaration);
  return (
    source +
    `\n;globalThis.__latencyRefs??=[];globalThis.__latencyRefs.push(${[...names].join(',')});\n`
  );
};

export async function loadLatencyAssets() {
  const names = (await readdir('dist')).filter((name) => !name.endsWith('.gz'));

  assert(
    names.includes('index.html'),
    'Build the production client before running latency',
  );

  const assets = new Map<string, { body: Buffer; contentType: string }>();

  const hashes: {
    name: string;
    originalSha256: string;
    instrumentedSha256: string;
    originalBytes: number;
    instrumentedBytes: number;
  }[] = [];

  for (const name of names) {
    const original = await readFile(`dist/${name}`);
    const body = name.endsWith('.js')
      ? Buffer.from(exposeLatencyBindings(original.toString()))
      : original;
    const contentType = name.endsWith('.js')
      ? 'text/javascript'
      : name.endsWith('.css')
        ? 'text/css'
        : name.endsWith('.woff2')
          ? 'font/woff2'
          : 'text/html';

    assets.set(name, { body, contentType });

    hashes.push({
      name,
      originalSha256: digest(original),
      instrumentedSha256: digest(body),
      originalBytes: original.length,
      instrumentedBytes: body.length,
    });
  }

  const cache = (await preparePropertyCache()).nameCache as {
    props: { props: Record<string, string> };
  };

  const properties = Object.fromEntries(
    Object.entries(cache.props.props).map(([name, value]) => {
      const raw = name.slice(1);

      return [propertyNames.includes(raw.slice(1)) ? raw.slice(1) : raw, value];
    }),
  );

  // Reserved and native names are deliberately absent from the Terser cache.
  for (const name of propertyNames) properties[name] ||= replacePreTerser(name);

  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  const dirty = Boolean(
    execFileSync(
      'git',
      ['status', '--porcelain', '--', 'src', 'plugins', 'vite.config.ts'],
      { encoding: 'utf8' },
    ).trim(),
  );

  return {
    assets,
    properties,
    tags: latencyLiterals,
    metadata: {
      mode: 'checkout-production-assets-at-requested-origin',
      revision,
      productionSourceDirty: dirty,
      hashes,
    },
  };
}
