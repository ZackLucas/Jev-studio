import { createReadStream, promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Serve the built SPA: real files when they exist, index.html otherwise. */
export async function serveStatic(root: string, pathname: string, res: ServerResponse): Promise<boolean> {
  const base = path.resolve(root);
  let file = path.resolve(base, '.' + decodeURIComponent(pathname));
  if (file !== base && !file.startsWith(base + path.sep)) file = path.join(base, 'index.html'); // no traversal

  let stat = await fs.stat(file).catch(() => null);
  if (!stat || stat.isDirectory()) {
    file = path.join(base, 'index.html');
    stat = await fs.stat(file).catch(() => null);
    if (!stat) return false;
  }

  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
  return true;
}
