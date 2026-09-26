import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const assets = resolve('dist');
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export const handleHttp = (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  if (request.headers.host === 'www.unicorn-mining.co') {
    response.writeHead(308, {
      Location: `https://unicorn-mining.co${request.url || '/'}`,
    });
    response.end();
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let pathname: string;

  try {
    pathname = decodeURIComponent(
      new URL(request.url || '/', 'http://local').pathname,
    );
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  if (pathname === '/server.js') {
    response.writeHead(404);
    response.end();
    return;
  }

  const file = resolve(
    assets,
    `.${pathname === '/' ? '/index.html' : pathname}`,
  );

  if (!file.startsWith(`${assets}${sep}`)) {
    response.writeHead(404);
    response.end();
    return;
  }

  void stat(file).then(
    (details) => {
      if (!details.isFile()) {
        response.writeHead(404);
        response.end();
        return;
      }

      response.writeHead(200, {
        'Cache-Control': file.endsWith('index.html')
          ? 'no-cache'
          : /-[\w-]+\.(?:js|css)$/.test(file)
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
        'Content-Length': details.size,
        'Content-Type':
          contentTypes[extname(file)] || 'application/octet-stream',
      });

      if (request.method === 'HEAD') response.end();
      else createReadStream(file).pipe(response);
    },
    () => {
      response.writeHead(404);
      response.end();
    },
  );
};
