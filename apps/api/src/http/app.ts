import { createServer, type RequestListener, type Server } from 'node:http';
import { z } from 'zod';
import { PRESETS, type ConfigUpdate, type RunRequest } from '@jev/core';
import type { HistoryRepo } from '../ports';
import type { ConfigService } from '../services/config-service';
import type { DecisionService } from '../services/decision-service';
import type { JeffService } from '../services/jeff-service';
import type { ScenarioService } from '../services/scenario-service';
import { AppError, notFound } from '../services/errors';
import { Reply, Router, sendJson } from './router';
import { serveStatic } from './static';

export interface AppDeps {
  decisions: DecisionService;
  scenarios: ScenarioService;
  config: ConfigService;
  history: HistoryRepo;
  /** Local jeff container control (Docker). */
  jeff: JeffService;
  /** Built web app to serve (production). Omit in dev — Vite serves it. */
  webDist?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const runSchema = z.object({
  body: z.record(z.unknown()),
  raw: z.boolean().optional(),
  retry: z.number().int().min(0).max(5).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  scenarioId: z.string().optional(),
});

const backendPatch = z.object({ baseUrl: z.string().optional(), apiKey: z.string().nullable().optional() });
const configSchema = z.object({
  backend: z.enum(['typesafe', 'jeff']).optional(),
  model: z.string().optional(),
  backends: z.object({ typesafe: backendPatch.optional(), jeff: backendPatch.optional() }).optional(),
  jeff: z.object({ autoStart: z.boolean().optional(), autoStop: z.boolean().optional(), device: z.enum(['auto', 'cpu', 'gpu']).optional() }).optional(),
});

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new AppError(400, 'BAD_REQUEST', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Requisição inválida.');
  }
  return r.data;
}

/** The API spends your TypeSafe key, so it only answers the local UI (blocks DNS rebinding and cross-site calls). */
function isLocalRequest(host: string | undefined, origin: string | undefined): boolean {
  const hostname = (host ?? '').replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.has(hostname)) return false;
  if (!origin) return true;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function buildRouter(deps: AppDeps): Router {
  const r = new Router();

  r.get('/api/health', async () => ({ ok: true }));
  r.get('/api/presets', async () => PRESETS.map(({ compile: _compile, ...meta }) => meta));

  // Decisions
  r.post('/api/decisions/:preset', async ({ params, body }) =>
    deps.decisions.run(params.preset!, parse(runSchema, body) as RunRequest),
  );
  /** Server-side preview of the exact official request (same code path as run, nothing sent). */
  r.post('/api/decisions/:preset/preview', async ({ params, body }) =>
    deps.decisions.buildRequest(params.preset!, parse(runSchema, body) as RunRequest),
  );

  // History
  r.get('/api/history', async () => deps.history.list());
  r.delete('/api/history', async () => {
    await deps.history.clear();
    return new Reply(204);
  });
  r.get('/api/history/:id', async ({ params }) => {
    const entry = await deps.history.get(params.id!);
    if (!entry) throw notFound('Registro');
    return entry;
  });
  r.delete('/api/history/:id', async ({ params }) => {
    if (!(await deps.history.remove(params.id!))) throw notFound('Registro');
    return new Reply(204);
  });

  // Scenarios
  r.get('/api/scenarios', async () => deps.scenarios.list());
  r.post('/api/scenarios', async ({ body }) => new Reply(201, await deps.scenarios.create(body)));
  r.put('/api/scenarios/:id', async ({ params, body }) => deps.scenarios.update(params.id!, body));
  r.delete('/api/scenarios/:id', async ({ params }) => {
    await deps.scenarios.remove(params.id!);
    return new Reply(204);
  });

  // Config
  r.get('/api/config', async () => deps.config.view());
  r.put('/api/config', async ({ body }) => {
    const input = parse(configSchema, body) as ConfigUpdate;
    const before = await deps.config.view();
    const view = await deps.config.update(input);
    // Auto start/stop runs in the background; the UI follows it through GET /api/jeff.
    if (view.backend !== before.backend) void deps.jeff.onBackendChanged(before.backend, view.backend);
    // Different device = different image: drop the running container so the next start uses it.
    if (view.jeff.device !== before.jeff.device) void deps.jeff.stop().catch(() => undefined);
    return view;
  });

  // Local jeff (Docker)
  r.get('/api/jeff', async () => deps.jeff.status());
  r.post('/api/jeff/start', async () => deps.jeff.start());
  r.post('/api/jeff/stop', async () => deps.jeff.stop());
  r.get('/api/jeff/logs', async ({ req }) => {
    const asked = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('tail'));
    const tail = Math.min(Math.max(asked || 200, 10), 2000);
    return { logs: await deps.jeff.logs(tail) };
  });

  return r;
}

export function buildHandler(deps: AppDeps): RequestListener {
  const router = buildRouter(deps);
  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (pathname.startsWith('/api/')) {
      if (!isLocalRequest(req.headers.host, req.headers.origin)) {
        return sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Apenas acesso local.' } });
      }
      if (!(await router.handle(req, res, pathname))) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
      }
      return;
    }

    if (deps.webDist && (req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(deps.webDist, pathname, res))) {
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
      'Interface não compilada. Rode "npm run dev" (desenvolvimento) ou "npm run build" e depois "npm start".',
    );
  };
}

export function buildServer(deps: AppDeps): Server {
  return createServer(buildHandler(deps));
}
