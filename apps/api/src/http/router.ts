/**
 * A tiny, dependency-free router over node:http.
 * It is an adapter like any other: if the app outgrows it, replace this file
 * and app.ts with Fastify/Hono — services and core stay untouched.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../services/errors';

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  body: unknown;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

/** A handler can return this to control the status code (e.g. 201, 204). */
export class Reply {
  constructor(
    public readonly status: number,
    public readonly body?: unknown,
  ) {}
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const MAX_BODY = 256 * 1024;

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/:([A-Za-z_]+)/g, (_, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }

  get = (p: string, h: Handler) => this.add('GET', p, h);
  post = (p: string, h: Handler) => this.add('POST', p, h);
  put = (p: string, h: Handler) => this.add('PUT', p, h);
  delete = (p: string, h: Handler) => this.add('DELETE', p, h);

  /** Returns false when no route matches the path (so the caller can fall through). */
  async handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    const candidates = this.routes
      .map((r) => ({ r, m: r.pattern.exec(pathname) }))
      .filter((x): x is { r: Route; m: RegExpExecArray } => x.m !== null);
    if (!candidates.length) return false;

    const hit = candidates.find((x) => x.r.method === req.method);
    try {
      if (!hit) throw new AppError(405, 'METHOD_NOT_ALLOWED', `Método ${req.method} não permitido.`);
      const params: Record<string, string> = {};
      hit.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(hit.m[i + 1]!)));
      const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readJsonBody(req);
      const out = await hit.r.handler({ req, params, body });
      if (out instanceof Reply) sendJson(res, out.status, out.body);
      else sendJson(res, 200, out);
    } catch (err) {
      if (err instanceof AppError) {
        sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
      } else {
        console.error(err);
        sendJson(res, 500, { error: { code: 'INTERNAL', message: (err as Error).message } });
      }
    }
    return true;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Requisição grande demais.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, 'BAD_JSON', 'O corpo da requisição não é JSON válido.');
  }
}

export function sendJson(res: ServerResponse, status: number, body?: unknown): void {
  if (status === 204 || body === undefined) {
    res.writeHead(status === 200 ? 204 : status).end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}
