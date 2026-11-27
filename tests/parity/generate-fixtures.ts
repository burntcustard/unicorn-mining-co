import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const scenarios = new URL('./scenarios/', import.meta.url);

for (const file of readdirSync(scenarios)
  .filter((name) => name.endsWith('.ts'))
  .sort()) {
  const { default: fixture } = await import(new URL(file, scenarios).href);

  const path = new URL(
    `../fixtures/${file.replace(/\.ts$/, '.json')}`,
    import.meta.url,
  );
  const contents = JSON.stringify(fixture) + '\n';

  if (!existsSync(path) || readFileSync(path, 'utf8') !== contents) {
    writeFileSync(path, contents);
  }
}
