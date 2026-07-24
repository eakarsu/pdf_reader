import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createServer } from 'node:http';

const root = resolve(process.cwd(), 'dist');
const requestedPort = Number.parseInt(process.env.PORT || '8080', 10);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65_536
  ? requestedPort
  : 8080;

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'self' blob:",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function writeText(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders,
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

async function sendFile(request, response, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });

  const immutable = filePath.includes(`${sep}assets${sep}`);
  response.writeHead(200, {
    ...securityHeaders,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Type': mimeTypes.get(extname(filePath)) || 'application/octet-stream',
    'Content-Length': fileStat.size,
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath).on('error', () => response.destroy()).pipe(response);
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    writeText(response, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    writeText(response, 200, 'ok\n');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    writeText(response, 400, 'Bad request\n');
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    writeText(response, 403, 'Forbidden\n');
    return;
  }

  try {
    await sendFile(request, response, candidate);
  } catch (error) {
    const acceptsHtml = request.headers.accept?.includes('text/html');
    if (error.code === 'ENOENT' && acceptsHtml) {
      try {
        await sendFile(request, response, resolve(root, 'index.html'));
      } catch {
        writeText(response, 500, 'Build output is unavailable\n');
      }
      return;
    }

    writeText(response, error.code === 'ENOENT' ? 404 : 500, 'Not found\n');
  }
});

server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Local PDF Reader listening on ${process.env.HOST || '127.0.0.1'}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
