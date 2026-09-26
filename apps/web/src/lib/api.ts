import type {
  ConfigUpdate,
  ConfigView,
  HistoryEntry,
  JeffStatus,
  RunRequest,
  RunResponse,
  Scenario,
  ScenarioInput,
} from '@jev/core';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Não consegui falar com o servidor local do Studio. Ele está rodando?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'HTTP', e.message ?? `HTTP ${res.status}`, e.details);
  }
  return data as T;
}

export const api = {
  run: (presetId: string, req: RunRequest & { scenarioId?: string }) =>
    http<RunResponse>('POST', `/api/decisions/${encodeURIComponent(presetId)}`, req),

  history: () => http<HistoryEntry[]>('GET', '/api/history'),
  deleteHistory: (id: string) => http<void>('DELETE', `/api/history/${id}`),
  clearHistory: () => http<void>('DELETE', '/api/history'),

  scenarios: () => http<Scenario[]>('GET', '/api/scenarios'),
  createScenario: (input: ScenarioInput) => http<Scenario>('POST', '/api/scenarios', input),
  updateScenario: (id: string, input: ScenarioInput) => http<Scenario>('PUT', `/api/scenarios/${id}`, input),
  deleteScenario: (id: string) => http<void>('DELETE', `/api/scenarios/${id}`),

  config: () => http<ConfigView>('GET', '/api/config'),
  updateConfig: (input: ConfigUpdate) => http<ConfigView>('PUT', '/api/config', input),

  jeffStatus: () => http<JeffStatus>('GET', '/api/jeff'),
  jeffStart: () => http<JeffStatus>('POST', '/api/jeff/start'),
  jeffStop: () => http<JeffStatus>('POST', '/api/jeff/stop'),
  jeffLogs: (tail = 300) => http<{ logs: string }>('GET', `/api/jeff/logs?tail=${tail}`),
};
