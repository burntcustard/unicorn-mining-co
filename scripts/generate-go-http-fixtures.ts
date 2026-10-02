import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { type IncomingMessage, type ServerResponse } from 'node:http';

const cwd = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'unicorn-http-port-'));
const files = {
  'index.html': '<html>game</html>',
  'assets/app-abc123.js': 'const game=1;',
  'assets/site-123.css': 'body{}',
  'nested/index.html': 'nested',
  'data.json': '{}',
  'image.svg': '<svg/>',
  'plain.txt': 'text',
  'data.bin': 'binary',
  'space name.txt': 'space',
};

try {
  await mkdir(join(temporary, 'dist/assets'), { recursive: true });
  await mkdir(join(temporary, 'dist/nested'), { recursive: true });
  await Promise.all(
    Object.entries(files).map(([name, contents]) =>
      writeFile(join(temporary, 'dist', name), contents),
    ),
  );
  process.chdir(temporary);
  const { handleHttp } = await import('../src/server/http-handler');
  const requests = [
    ...[
      '/healthz',
      '/healthz?check=1',
      '/',
      '/index.html?x=1',
      '/assets/app-abc123.js',
      '/assets/site-123.css',
      '/nested/index.html',
      '/data.json',
      '/image.svg',
      '/plain.txt',
      '/data.bin',
      '/space%20name.txt',
      '/server.js',
      '/%73erver.js',
      '/assets',
      '/missing',
      '/assets/../index.html',
      '/assets/%2e%2e/index.html',
      '/%2e%2e%2fpackage.json',
      '/%ff',
      '/bad%escape',
    ].map((url) => ({ url, method: 'GET', headers: { host: 'local' } })),
    { url: '/index.html', method: 'HEAD', headers: { host: 'local' } },
    { url: '/', method: 'POST', headers: { host: 'local' } },
    {
      url: '/healthz',
      method: 'POST',
      headers: { host: 'www.unicorn-mining.co' },
    },
    {
      url: '/a?b=1',
      method: 'POST',
      headers: { host: 'www.unicorn-mining.co' },
    },
    {
      url: '/index.html',
      method: 'GET',
      headers: {
        host: 'local',
        range: 'bytes=0-2',
        'if-modified-since': 'Wed, 01 Jan 2100 00:00:00 GMT',
      },
    },
  ];
  const samples = [];

  for (const request of requests) {
    let status = 0;
    let headers: Record<string, string | number> = {};
    let body = '';
    const response = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          body += chunk.toString();
          done();
        },
      }),
      {
        writeHead(code: number, values: Record<string, string | number> = {}) {
          status = code;
          headers = values;
        },
      },
    );
    const finished = new Promise<void>((resolve, reject) => {
      response.on('finish', resolve);
      response.on('error', reject);
    });

    handleHttp(
      request as IncomingMessage,
      response as unknown as ServerResponse,
    );
    await finished;
    samples.push({ request, status, headers, body });
  }
  process.chdir(cwd);
  await writeFile(
    'tests/go-fixtures/http.json',
    JSON.stringify({ files, samples }),
  );
} finally {
  process.chdir(cwd);
  await rm(temporary, { recursive: true, force: true });
}
