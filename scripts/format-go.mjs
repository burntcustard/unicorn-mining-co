import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) visit(path);
    else if (entry.isFile() && path.endsWith('.go')) files.push(path);
  }
};

['cmd', 'internal', 'tests/go-fixtures', 'benchmarking'].forEach(visit);
files.sort((a, b) => a.localeCompare(b));

const check = process.argv.includes('--check');
const result = spawnSync('gofmt', [check ? '-l' : '-w', ...files], {
  encoding: 'utf8',
});

if (result.stdout) process.stdout.write(result.stdout);

if (result.stderr) process.stderr.write(result.stderr);

if (result.error) console.error(result.error.message);

if (result.error || result.status !== 0 || (check && result.stdout.trim())) {
  process.exitCode = 1;
}
