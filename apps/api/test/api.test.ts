import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBody, getPreset, type HistoryEntry, type Scenario, type SystemOneResult } from '@jev/core';
import { FileRepository, MemoryRepository } from '../src/adapters/file-repository';
import { FileSettingsStore } from '../src/adapters/file-settings';
import { buildServer, type AppDeps } from '../src/http/app';
import type { SystemOneGateway } from '../src/ports';
import { ConfigService } from '../src/services/config-service';
import { DecisionService } from '../src/services/decision-service';
import { ScenarioService } from '../src/services/scenario-service';

class FakeGateway implements SystemOneGateway {
  calls: { request: Parameters<SystemOneGateway['evaluate']>[0]; opts: Parameters<SystemOneGateway['evaluate']>[1] }[] = [];
  next: Partial<SystemOneResult> = {};
  evaluate: SystemOneGateway['evaluate'] = async (request, opts) => {
    this.calls.push({ request, opts });
    return {
      ok: true,
      status: 200,
      url: opts.baseUrl + '/v1/systemone',
      elapsedMs: 42,
      attempts: 1,
      response: {
        model: request.model,
        answers: {
          decision: { type: 'choice', choice: 'review', confidence: 0.6, probabilities: { review: 0.6, deny: 0.4 } },
          needs_confirmation: { type: 'noul', noul: 0.9 },
        },
        usage: { input_tokens: 10, output_tokens: 2 },
      },
      ...this.next,
    };
  };
}

const example = (id: string) => buildBody(getPreset(id)!, getPreset(id)!.example).body;

describe('Studio API', () => {
  let base = '';
  let dir = '';
  let gateway: FakeGateway;
  let deps: AppDeps;
  const server = buildServer({
    get decisions() { return deps.decisions; },
    get scenarios() { return deps.scenarios; },
    get config() { return deps.config; },
    get history() { return deps.history; },
    get jeff() { return deps.jeff; },
    get webDist() { return deps.webDist; },
  } as AppDeps);

  before(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  function setup(env: NodeJS.ProcessEnv = {}) {
    dir = mkdtempSync(path.join(os.tmpdir(), 'jev-studio-'));
    const settings = new FileSettingsStore(path.join(dir, 'config.json'), env);
    gateway = new FakeGateway();
    const history = new MemoryRepository<HistoryEntry>();
    deps = {
      decisions: new DecisionService(gateway, settings, history),
      scenarios: new ScenarioService(new MemoryRepository<Scenario>()),
      config: new ConfigService(settings, dir),
      history,
      jeff: { onBackendChanged: async () => {} } as unknown as AppDeps['jeff'], // covered in jeff.test.ts
    };
  }
  beforeEach(() => setup());

  async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  }
  const setTypesafeKey = () => call('PUT', '/api/config', { backends: { typesafe: { apiKey: 'ts_live_123456' } } });

  it('defaults to the official TypeSafe API and jev-latest', async () => {
    const cfg = (await call('GET', '/api/config')).json;
    assert.equal(cfg.backend, 'typesafe');
    assert.equal(cfg.model, 'jev-latest');
    assert.equal(cfg.backends.typesafe.baseUrl, 'https://api.typesafe.ai');
    assert.equal(cfg.backends.typesafe.keyEnv, 'TYPESAFE_API_KEY');
    assert.equal(cfg.backends.jeff.baseUrl, 'http://localhost:8000');
  });

  it('requires a TypeSafe key before calling the official API', async () => {
    const r = await call('POST', '/api/decisions/route', { body: example('route') });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'NO_KEY');
    assert.equal(gateway.calls.length, 0);
  });

  it('prefers TYPESAFE_API_KEY from the environment and never returns the full key', async () => {
    setup({ TYPESAFE_API_KEY: 'env-key-abcdef' });
    let cfg = (await call('GET', '/api/config')).json;
    assert.equal(cfg.backends.typesafe.keySource, 'env');
    cfg = (await setTypesafeKey()).json;
    assert.equal(cfg.backends.typesafe.keySource, 'env');
    assert.ok(!JSON.stringify(cfg).includes('env-key-abcdef'));
    assert.ok(!JSON.stringify(cfg).includes('ts_live_123456'));
  });

  it('compiles a recipe into the official request and records it', async () => {
    await setTypesafeKey();
    const r = await call('POST', '/api/decisions/tool-guard', { body: example('tool-guard'), retry: 2 });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.backend, 'typesafe');
    assert.deepEqual(r.json.summary, { question: 'decision', type: 'choice', decision: 'review', confidence: 0.6, probabilities: { review: 0.6, deny: 0.4 } });

    const sent = gateway.calls[0]!;
    assert.equal(sent.opts.baseUrl, 'https://api.typesafe.ai');
    assert.equal(sent.opts.apiKey, 'ts_live_123456');
    assert.equal(sent.opts.retry, 2);
    assert.equal(sent.request.model, 'jev-latest');
    assert.deepEqual(Object.keys(sent.request.questions), ['decision', 'needs_confirmation', 'risk']);
    assert.deepEqual(r.json.request, sent.request);
    assert.deepEqual(r.json.input, example('tool-guard'));

    const hist = (await call('GET', '/api/history')).json;
    assert.equal(hist.length, 1);
    assert.equal((await call('DELETE', `/api/history/${hist[0].id}`)).status, 204);
  });

  it('previews the exact request without sending it', async () => {
    const r = await call('POST', '/api/decisions/research/preview', { body: example('research') });
    assert.equal(r.status, 200);
    assert.equal(r.json.questions.decision.type, 'choice');
    assert.equal(gateway.calls.length, 0);
  });

  it('switches to jeff: same request, local URL, key optional', async () => {
    await call('PUT', '/api/config', { backend: 'jeff', backends: { jeff: { baseUrl: 'http://localhost:9000/' } } });
    const r = await call('POST', '/api/decisions/tool-guard', { body: example('tool-guard') });
    assert.equal(r.status, 200);
    assert.equal(r.json.backend, 'jeff');
    assert.equal(gateway.calls[0]!.opts.baseUrl, 'http://localhost:9000');
    assert.equal(gateway.calls[0]!.opts.apiKey, undefined);

    await call('PUT', '/api/config', { backends: { jeff: { apiKey: 'devkey' } } });
    await call('POST', '/api/decisions/decide', { body: example('decide') });
    assert.equal(gateway.calls[1]!.opts.apiKey, 'devkey');
  });

  it('sends raw official requests as-is, filling in the model', async () => {
    await setTypesafeKey();
    const raw = { state: 'The export button crashes in Safari.', questions: { severity: { type: 'score', instructions: 'How severe?', criteria: ['cosmetic', 'degraded', 'blocking'] } } };
    const r = await call('POST', '/api/decisions/decide', { body: raw, raw: true });
    assert.equal(r.status, 200);
    assert.deepEqual(gateway.calls[0]!.request, { ...raw, model: 'jev-latest' });

    await call('POST', '/api/decisions/decide', { body: { ...raw, model: 'jev' }, raw: true });
    assert.equal(gateway.calls[1]!.request.model, 'jev');

    const bad = await call('POST', '/api/decisions/decide', { body: { state: 'x', questions: {} }, raw: true });
    assert.equal(bad.json.error.code, 'INVALID_REQUEST');
  });

  it('validates recipe fields and unknown presets', async () => {
    await setTypesafeKey();
    assert.equal((await call('POST', '/api/decisions/route', { body: {} })).json.error.code, 'INVALID_BODY');
    assert.equal((await call('POST', '/api/decisions/nope', { body: {} })).status, 404);
    assert.equal((await call('POST', '/api/decisions/route', { nobody: 1 })).status, 400);
  });

  it('records API errors with a hint', async () => {
    await setTypesafeKey();
    gateway.next = { ok: false, status: 429, response: null, attempts: 3, error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } };
    const entry = (await call('POST', '/api/decisions/route', { body: example('route') })).json;
    assert.equal(entry.ok, false);
    assert.match(entry.error.message, /Rate limit exceeded — limite de requisições da TypeSafe|limite de requisições do TypeSafe/);
    assert.match(entry.error.message, /tentou 3 vezes/);
  });

  it('validates config values', async () => {
    assert.equal((await call('PUT', '/api/config', { backends: { typesafe: { baseUrl: 'not a url' } } })).status, 400);
    assert.equal((await call('PUT', '/api/config', { backend: 'jev' })).status, 400);
    assert.equal((await call('PUT', '/api/config', { model: '  ' })).status, 400);
    const ok = (await call('PUT', '/api/config', { model: 'jev', backends: { typesafe: { baseUrl: 'https://api.typesafe.ai/v1/' } } })).json;
    assert.equal(ok.model, 'jev');
    assert.equal(ok.backends.typesafe.baseUrl, 'https://api.typesafe.ai');
  });

  it('manages scenarios, including raw ones', async () => {
    const created = await call('POST', '/api/scenarios', { name: 'Reembolso alto', presetId: 'tool-guard', body: example('tool-guard') });
    assert.equal(created.status, 201);
    const id = created.json.id;
    const updated = await call('PUT', `/api/scenarios/${id}`, { name: 'Cru', presetId: 'decide', body: { state: 'x' }, raw: true });
    assert.equal(updated.json.raw, true);
    assert.equal((await call('DELETE', `/api/scenarios/${id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/scenarios/${id}`)).status, 404);
    assert.equal((await call('POST', '/api/scenarios', { name: '', presetId: 'nope', body: {} })).status, 400);
  });

  it('rejects cross-site origins and handles bad JSON', async () => {
    assert.equal((await call('GET', '/api/config', undefined, { origin: 'https://evil.com' })).status, 403);
    assert.equal((await call('GET', '/api/config', undefined, { origin: 'http://localhost:5173' })).status, 200);
    const res = await fetch(base + '/api/scenarios', { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 400);
  });

  it('serves the SPA without path traversal', async () => {
    const web = path.join(dir, 'web');
    mkdirSync(path.join(web, 'assets'), { recursive: true });
    writeFileSync(path.join(web, 'index.html'), '<h1>studio</h1>');
    writeFileSync(path.join(web, 'assets', 'a.js'), 'x');
    writeFileSync(path.join(dir, 'secret.txt'), 'secret');
    deps.webDist = web;
    assert.equal(await (await fetch(base + '/history')).text(), '<h1>studio</h1>');
    assert.equal(await (await fetch(base + '/assets/a.js')).text(), 'x');
    assert.equal(await (await fetch(base + '/%2e%2e/secret.txt')).text(), '<h1>studio</h1>');
  });
});

describe('FileRepository', () => {
  it('persists, caps and survives concurrent writes', async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'jev-repo-')), 'h.json');
    const repo = new FileRepository<{ id: string }>(file, 5);
    await Promise.all(Array.from({ length: 10 }, (_, i) => repo.upsert({ id: String(i) })));
    const items = await new FileRepository<{ id: string }>(file).list();
    assert.equal(items.length, 5);
    assert.equal(items[0]!.id, '9');
  });
});
