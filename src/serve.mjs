// Serves a directory over HTTP on a free local port, the way Cloudflare's asset layer
// answers, so the checks run against a build or a concept with no external dependency.
// Shared by dc-qa and dc-compare.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/** Serves `root`; resolves to its origin and a close(). */
export async function serve(root) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const path = join(base, decodeURIComponent(req.url.split('?')[0]));
    // The same lookups Cloudflare makes: the file itself, /about -> about.html, and
    // /about or /about/ -> about/index.html. Without the last one, a link typed
    // without its trailing slash is reported broken although it works live.
    for (const file of [path, `${path}.html`, join(path, 'index.html')]) {
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        return res.end(body);
      } catch {
        // Not this one (or it is a directory); try the next.
      }
    }
    res.writeHead(404).end('not found');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
