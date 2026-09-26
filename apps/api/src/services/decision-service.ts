import { randomUUID } from 'node:crypto';
import {
  bodySchema,
  compileRequest,
  getPreset,
  summarize,
  systemOneRequestSchema,
  type Backend,
  type HistoryEntry,
  type RunRequest,
  type SystemOneError,
  type SystemOneRequest,
} from '@jev/core';
import type { HistoryRepo, SettingsStore, SystemOneGateway } from '../ports';
import { AppError, notFound } from './errors';

const BACKEND_NAME: Record<Backend, string> = { typesafe: 'TypeSafe', jeff: 'jeff' };

/** Use case: compile a preset into an official request, evaluate it and record it in the history. */
export class DecisionService {
  constructor(
    private readonly gateway: SystemOneGateway,
    private readonly settings: SettingsStore,
    private readonly history: HistoryRepo,
  ) {}

  /** The exact request that would be sent — used by run() and by the preview. */
  async buildRequest(presetId: string, req: Pick<RunRequest, 'body' | 'raw'>): Promise<SystemOneRequest> {
    const preset = getPreset(presetId);
    if (!preset) throw notFound(`Preset "${presetId}"`);
    const model = await this.settings.getModel();
    const body = req.body ?? {};

    if (req.raw) {
      const parsed = systemOneRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_REQUEST', 'Requisição inválida para /v1/systemone.', parsed.error.flatten());
      }
      return { ...(body as unknown as SystemOneRequest), model: typeof body.model === 'string' && body.model ? body.model : model };
    }

    const parsed = bodySchema(preset).safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_BODY', 'Campos inválidos para esta rota.', parsed.error.flatten());
    }
    return compileRequest(preset, body, model);
  }

  async run(presetId: string, req: RunRequest): Promise<HistoryEntry> {
    const request = await this.buildRequest(presetId, req);
    const preset = getPreset(presetId)!;
    const backend = await this.settings.getBackend();
    const key = await this.settings.resolveKey(backend);
    if (!key && backend === 'typesafe') {
      throw new AppError(400, 'NO_KEY', 'Nenhuma API key da TypeSafe configurada. Defina a chave em Configurações.');
    }

    const result = await this.gateway.evaluate(request, {
      baseUrl: await this.settings.getBaseUrl(backend),
      apiKey: key?.key,
      retry: req.retry,
      timeoutMs: req.timeoutMs,
    });

    const entry: HistoryEntry = {
      id: randomUUID(),
      presetId,
      backend,
      createdAt: new Date().toISOString(),
      input: req.body ?? {},
      raw: Boolean(req.raw),
      request,
      ok: result.ok,
      status: result.status,
      elapsedMs: result.elapsedMs,
      attempts: result.attempts,
      response: result.response,
      summary: result.ok ? summarize(result.response, preset.primary) : {},
      error: result.error ? withHint(result.error, backend, result.attempts) : undefined,
      scenarioId: req.scenarioId,
    };
    await this.history.upsert(entry);
    return entry;
  }
}

function withHint(error: SystemOneError, backend: Backend, attempts: number): SystemOneError {
  const name = BACKEND_NAME[backend];
  const tried = attempts > 1 ? ` (o Studio tentou ${attempts} vezes)` : '';
  const hints: Partial<Record<SystemOneError['type'], string>> = {
    authentication_error:
      backend === 'typesafe'
        ? 'verifique a chave da TypeSafe em Configurações.'
        : 'a chave do jeff não bate com JEFF_API_KEYS do servidor.',
    validation_error: `o ${name} recusou a requisição; confira as questions e o modelo.`,
    rate_limit_error: `limite de requisições do ${name}${tried}. Espere um pouco antes de enviar de novo.`,
    overloaded_error: `o ${name} está sobrecarregado${tried}. Tente de novo em instantes.`,
    server_error: `instabilidade no ${name}${tried}.`,
    network_error:
      backend === 'jeff'
        ? 'o jeff está ligado? Ligue em Configurações → jeff (ou "jev-studio jeff start").'
        : 'verifique sua conexão e a base URL.',
    timeout: `o ${name} demorou demais${tried}.`,
  };
  const hint = hints[error.type];
  return hint ? { ...error, message: `${error.message} — ${hint}` } : error;
}
