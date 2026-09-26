/**
 * Composition root: the only place that knows the concrete adapters.
 * Swap an adapter here (e.g. SQLite instead of JSON files) and nothing else changes.
 */
import path from 'node:path';
import type { HistoryEntry, Scenario } from '@jev/core';
import { FileRepository } from './adapters/file-repository';
import { FileSettingsStore } from './adapters/file-settings';
import { DockerJeffRuntime } from './adapters/docker-jeff-runtime';
import { HttpSystemOneGateway } from './adapters/http-systemone-gateway';
import { buildServer } from './http/app';
import { DATA_DIR, JEFF_COMPOSE_FILES, jeffImage, WEB_DIST } from './paths';
import { ConfigService } from './services/config-service';
import { DecisionService } from './services/decision-service';
import { JeffService } from './services/jeff-service';
import { ScenarioService } from './services/scenario-service';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 5174);
const HISTORY_LIMIT = Number(process.env.JEV_HISTORY_LIMIT ?? 300);
const DEV = process.env.NODE_ENV === 'development';

const settings = new FileSettingsStore(path.join(DATA_DIR, 'config.v2.json'));
// v2: official-format entries; the old community-format files are left untouched.
const history = new FileRepository<HistoryEntry>(path.join(DATA_DIR, 'history.v2.json'), HISTORY_LIMIT);
const scenarios = new FileRepository<Scenario>(path.join(DATA_DIR, 'scenarios.json'));

const jeff = new JeffService(
  new DockerJeffRuntime({
    cpu: { composeFile: JEFF_COMPOSE_FILES.cpu, image: jeffImage('cpu') },
    gpu: { composeFile: JEFF_COMPOSE_FILES.gpu, image: jeffImage('gpu') },
  }),
  settings,
);

const server = buildServer({
  decisions: new DecisionService(new HttpSystemOneGateway(), settings, history),
  scenarios: new ScenarioService(scenarios),
  config: new ConfigService(settings, DATA_DIR),
  history,
  jeff,
  webDist: DEV ? undefined : WEB_DIST,
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? `A porta ${PORT} já está em uso. Use PORT=xxxx.` : err);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  const backend = await settings.getBackend();
  const key = await settings.resolveKey(backend);
  const url = DEV ? 'http://localhost:5173' : `http://localhost:${PORT}`;
  console.log(`\n  JEV Studio  →  ${url}`);
  console.log(`  Backend: ${backend} (${await settings.getBaseUrl(backend)}), modelo ${await settings.getModel()}`);
  console.log(`  Chave: ${key ? `ok (${key.source})` : backend === 'typesafe' ? 'não configurada — defina em Configurações' : 'nenhuma (opcional no jeff)'}`);
  console.log(`  Dados: ${DATA_DIR}\n`);
  void jeff.onStudioStart((msg) => console.log(`  ${msg}`));
});

let closing = false;
async function shutdown() {
  if (closing) process.exit(0); // second Ctrl+C: leave now
  closing = true;
  server.close();
  await jeff.onStudioClose((msg) => console.log(`  ${msg}`));
  process.exit(0);
}
process.on('SIGINT', shutdown);
// tsx watch restarts with SIGTERM in dev: don't stop jeff on every reload.
process.on('SIGTERM', DEV ? () => process.exit(0) : shutdown);
