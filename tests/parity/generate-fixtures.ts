import { readdirSync, writeFileSync } from 'node:fs';

const scenarios = new URL('./scenarios/', import.meta.url);

for (const file of readdirSync(scenarios)
  .filter((name) => name.endsWith('.ts'))
  .sort()) {
  const { default: fixture } = await import(new URL(file, scenarios).href);

  writeFileSync(
    new URL(`../fixtures/${file.replace(/\.ts$/, '.json')}`, import.meta.url),
    JSON.stringify(fixture) + '\n',
  );
}
