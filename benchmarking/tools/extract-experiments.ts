import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const archives = new URL('../archive/', import.meta.url);
const [date = 'all', output = 'benchmarking/local/restored'] =
  process.argv.slice(2);

for (const name of readdirSync(archives)) {
  if (name.endsWith('.zip') && (date === 'all' || name === `${date}.zip`)) {
    execFileSync(
      'python3',
      ['-m', 'zipfile', '-e', fileURLToPath(new URL(name, archives)), output],
      { stdio: 'inherit' },
    );
  }
}
