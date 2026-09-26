import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL,
  PRESETS,
  SystemOneClient,
  bodySchema,
  bodyToValues,
  buildBody,
  compileRequest,
  emptyValues,
  errorMessage,
  getPreset,
  retryDelayMs,
  summarize,
  systemOneRequestSchema,
  type SystemOneResponse,
} from '../src/index';

const exampleBody = (id: string) => buildBody(getPreset(id)!, getPreset(id)!.example).body;

describe('presets', () => {
  it('have unique ids and valid examples', () => {
    const ids = PRESETS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of PRESETS) {
      const built = buildBody(p, p.example);
      assert.ok(built.ok, `${p.id}: ${JSON.stringify(!built.ok && built.errors)}`);
      assert.ok(bodySchema(p).safeParse(built.body).success, p.id);
    }
  });

  it('every preset compiles its example into a valid official request', () => {
    for (const p of PRESETS) {
      const req = compileRequest(p, exampleBody(p.id), DEFAULT_MODEL);
      const parsed = systemOneRequestSchema.safeParse(req);
      assert.ok(parsed.success, `${p.id}: ${JSON.stringify(!parsed.success && parsed.error.issues)}`);
      assert.equal(req.model, 'jev-latest');
    }
  });

  it('recipes put the primary choice question first with the declared options', () => {
    for (const p of PRESETS.filter((x) => x.kind === 'recipe')) {
      const req = compileRequest(p, exampleBody(p.id), DEFAULT_MODEL);
      const q = req.questions[p.primary!];
      assert.equal(q?.type, 'choice', p.id);
      if (p.decisions.length && q?.type === 'choice') assert.deepEqual(Object.keys(q.criteria), [...p.decisions], p.id);
    }
  });

  it('tool-guard state leaves out empty fields', () => {
    const p = getPreset('tool-guard')!;
    const req = compileRequest(p, { tool: 't', action: 'a', arguments: [] }, 'jev-latest');
    assert.deepEqual(req.state, { tool: 't', intended_action: 'a' });
  });

  it('model-route turns candidates into choice options, keeping extra JSON as the description', () => {
    const p = getPreset('model-route')!;
    const req = compileRequest(p, exampleBody('model-route'), 'jev-latest');
    const q = req.questions.decision;
    assert.equal(q?.type, 'choice');
    if (q?.type === 'choice') {
      assert.deepEqual(q.criteria['fast-model'], { cost: 'low', description: 'Fast, 32k context' });
      assert.deepEqual(Object.keys(q.criteria), ['fast-model', 'reasoning-model']);
    }
    const dup = buildBody(p, { ...p.example, candidates: [{ id: 'a', description: '', extra: '' }, { id: 'a', description: '', extra: '' }] });
    assert.equal(dup.ok, false);
  });

  it('native state accepts plain text or JSON, and flags broken JSON', () => {
    const p = getPreset('decide')!;
    const text = buildBody(p, { ...p.example, state: 'The export button crashes in Safari.' });
    assert.equal(text.body.state, 'The export button crashes in Safari.');
    assert.equal(buildBody(p, { ...p.example, state: '{oops' }).ok, false);
  });

  it('reports required fields on an empty form', () => {
    const p = getPreset('tool-guard')!;
    const built = buildBody(p, emptyValues(p));
    assert.equal(built.ok, false);
    if (!built.ok) assert.deepEqual(Object.keys(built.errors).sort(), ['action', 'tool']);
  });

  it('round-trips body -> values -> body', () => {
    for (const p of PRESETS) {
      const body = exampleBody(p.id);
      assert.deepEqual(buildBody(p, bodyToValues(p, body)).body, body);
    }
  });

  it('validates official requests', () => {
    assert.equal(systemOneRequestSchema.safeParse({ state: 'x', questions: {} }).success, false);
    assert.equal(
      systemOneRequestSchema.safeParse({ state: 'x', questions: { s: { type: 'score', instructions: 'i', criteria: ['one'] } } }).success,
      false,
    );
    assert.equal(systemOneRequestSchema.safeParse({ state: 'x', questions: { n: { type: 'noul', instructions: 'i' } } }).success, true);
  });
});

describe('summarize', () => {
  const res: SystemOneResponse = {
    model: 'jev-latest',
    answers: {
      needs_confirmation: { type: 'noul', noul: 0.9 },
      risk: { type: 'score', score: 2.4, confidence: 0.5, legend: { '2': 'High', '3': 'Critical' }, probabilities: {} },
      decision: { type: 'choice', choice: 'review', confidence: 0.46, probabilities: { review: 0.6, deny: 0.4 } },
    },
  };

  it('uses the primary question, else the first choice, else the first answer', () => {
    assert.equal(summarize(res, 'decision').decision, 'review');
    assert.equal(summarize(res).decision, 'review');
    assert.equal(summarize(res, 'risk').decision, 'High');
    assert.equal(summarize({ model: 'm', answers: { n: { type: 'noul', noul: 0.3 } } }).noul, 0.3);
    assert.deepEqual(summarize(null), {});
  });
});

describe('SystemOneClient', () => {
  const ok = () =>
    new Response(JSON.stringify({ model: 'jev-latest', answers: { a: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: 5, output_tokens: 1 } }), {
      status: 200,
    });
  const fakeFetch = (fn: (url: string, init: RequestInit) => Response) => (async (u: string, i: RequestInit) => fn(u, i)) as unknown as typeof fetch;
  const req = { state: 'x', model: 'jev-latest', questions: { a: { type: 'noul' as const, instructions: 'q' } } };

  it('posts to /v1/systemone with bearer auth', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new SystemOneClient({
      baseUrl: 'https://api.typesafe.ai/',
      apiKey: 'k_1',
      fetch: fakeFetch((url, init) => ((seen = { url, init }), ok())),
    });
    const r = await client.evaluate(req);
    assert.equal(r.ok, true);
    assert.equal(seen!.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer k_1');
    assert.equal(r.response?.answers.a?.type, 'noul');
  });

  it('omits Authorization when there is no key (local jeff without keys)', async () => {
    let headers: Record<string, string> = {};
    const client = new SystemOneClient({ baseUrl: 'http://localhost:8000', fetch: fakeFetch((_u, i) => ((headers = i.headers as Record<string, string>), ok())) });
    await client.evaluate(req);
    assert.equal('Authorization' in headers, false);
  });

  it('retries 429/529 honoring retry-after-ms, and gives up on 422', async () => {
    let calls = 0;
    const limited = new SystemOneClient({
      baseUrl: 'http://x',
      retry: 2,
      fetch: fakeFetch(() =>
        ++calls < 3
          ? new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } }), {
              status: calls === 1 ? 429 : 529,
              headers: { 'retry-after-ms': '1' },
            })
          : ok(),
      ),
    });
    const r = await limited.evaluate(req);
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 3);

    let calls422 = 0;
    const invalid = new SystemOneClient({
      baseUrl: 'http://x',
      retry: 3,
      fetch: fakeFetch(() => (calls422++, new Response(JSON.stringify({ detail: [{ loc: ['body', 'model'], msg: "Unknown model 'x'" }] }), { status: 422 }))),
    });
    const bad = await invalid.evaluate(req);
    assert.equal(calls422, 1);
    assert.equal(bad.error?.type, 'validation_error');
    assert.equal(bad.error?.message, "model: Unknown model 'x'");
  });

  it('reports network failures without throwing', async () => {
    const client = new SystemOneClient({
      baseUrl: 'http://x',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    const r = await client.evaluate(req);
    assert.equal(r.ok, false);
    assert.equal(r.error?.type, 'network_error');
  });

  it('computes retry delays', () => {
    assert.deepEqual([1, 2, 3].map((a) => retryDelayMs(a, true)), [2000, 4000, 8000]);
    assert.equal(retryDelayMs(1, false), 700);
    assert.equal(retryDelayMs(1, true, { retryAfter: '5' }), 5000);
    assert.equal(retryDelayMs(1, true, { retryAfterMs: '250', retryAfter: '9' }), 250);
    assert.equal(retryDelayMs(1, true, { retryAfter: '999' }), 30_000);
  });

  it('extracts readable error messages', () => {
    assert.equal(errorMessage(401, { error: { type: 'authentication_error', message: 'Invalid API key' } }), 'Invalid API key');
    assert.equal(errorMessage(500, {}), 'HTTP 500');
  });
});
